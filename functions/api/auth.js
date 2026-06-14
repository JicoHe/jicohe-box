/**
 * Cloudflare Pages Function — 管理认证 (WebAuthn + Face ID)
 * 
 * GET  /api/auth/challenge?session=XXX          → 获取 WebAuthn challenge
 * POST /api/auth/verify  {session, credential}  → 验证 Face ID 签名
 * GET  /api/auth/status?session=XXX             → 检查会话状态
 * 
 * 需要在 Cloudflare 设置环境变量:
 *   WEBAUTHN_CREDENTIAL = {"id":"...","publicKey":"..."}
 *     (首次注册后从 register.html 获取)
 *   RP_ID = jicohe-box.cn
 *   RP_NAME = JicoBox
 */

// ── 会话存储 ──
const sessions = new Map();

// ── Base64URL 编解码（避免 spread 操作符，Cloudflare Workers 兼容） ──
function b64urlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlDecode(str) {
    str = (str || "").trim().replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ── 解析 credential public key (CBOR → JWK/CryptoKey) ──
function parsePublicKey(base64urlKey) {
    // 简单方法：直接导入 Base64URL 编码的 raw public key (P-256 uncompressed)
    const rawKey = b64urlDecode(base64urlKey);
    return crypto.subtle.importKey(
        "spki",
        rawKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
    );
}

// ── 验证 WebAuthn 签名 ──
async function verifyWebAuthn(credential, storedCred, challenge) {
    // 1. 检查 credential ID 匹配
    if (credential.id !== storedCred.id) return false;

    // 2. 解析 authenticatorData
    const response = credential.response;
    const authData = b64urlDecode(response.authenticatorData);
    const clientDataJSON = b64urlDecode(response.clientDataJSON);
    const signature = b64urlDecode(response.signature);

    // 3. 验证 clientDataJSON 包含正确的 challenge
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
    if (clientData.challenge !== challenge) return false;

    // 4. 验证签名
    const publicKey = await parsePublicKey(storedCred.publicKey);
    const sigData = new Uint8Array(authData.length + 32); // authData + SHA-256 of clientDataJSON
    sigData.set(authData);
    const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
    sigData.set(clientHash, authData.length);

    return crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        signature,
        sigData
    ).catch(() => false);
}

// ── 主 Handler ──
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 清理过期会话
    const now = Date.now();
    for (const [sid, data] of sessions) {
        if (now > data.expires) sessions.delete(sid);
    }

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    // ── POST /api/auth/password ──
    if (request.method === "POST" && url.pathname.endsWith("/password")) {
        let body;
        try { body = await request.json(); } catch {
            return new Response(JSON.stringify({ status: "error", error: "invalid json" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
        const pw = body.password || "";
        const expected = env.SITE_PASSWORD || "";
        if (!expected) {
            return new Response(JSON.stringify({ status: "error", error: "SITE_PASSWORD not configured" }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
        if (pw === expected) {
            return new Response(JSON.stringify({ status: "ok" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
        return new Response(JSON.stringify({ status: "wrong" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    // ── GET /api/auth/challenge?session=XXX ──
    if (request.method === "GET" && url.pathname.endsWith("/challenge")) {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) {
            return new Response(JSON.stringify({ error: "missing session" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 生成随机 challenge
        const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
        const challenge = b64urlEncode(challengeBytes);

        // 获取存储的 credential（用于 allowCredentials）
        let storedCred = null;
        try {
            const raw = env.WEBAUTHN_CREDENTIAL || "null";
            storedCred = JSON.parse(raw);
            // 清理可能来自 env var 的空白字符
            if (storedCred && storedCred.id) storedCred.id = storedCred.id.trim();
            if (storedCred && storedCred.publicKey) storedCred.publicKey = storedCred.publicKey.trim();
        } catch {}

        sessions.set(sessionId, {
            challenge,
            status: "pending",
            expires: now + 120000
        });

        return new Response(JSON.stringify({
            challenge,
            rpId: env.RP_ID || "jicohe-box.cn",
            allowCredentials: storedCred ? [{ id: storedCred.id, type: "public-key" }] : [],
            timeout: 60000,
            userVerification: "required"
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    // ── POST /api/auth/verify ──
    if (request.method === "POST" && url.pathname.endsWith("/verify")) {
        let body;
        try { body = await request.json(); } catch {
            return new Response(JSON.stringify({ error: "invalid json" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const { session: sessionId, credential } = body;
        if (!sessionId || !credential) {
            return new Response(JSON.stringify({ error: "missing fields" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const session = sessions.get(sessionId);
        if (!session || now > session.expires) {
            sessions.delete(sessionId);
            return new Response(JSON.stringify({ status: "expired" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 获取存储的 credential
        let storedCred = null;
        try {
            const raw = env.WEBAUTHN_CREDENTIAL || "null";
            storedCred = JSON.parse(raw);
            if (storedCred && storedCred.id) storedCred.id = storedCred.id.trim();
            if (storedCred && storedCred.publicKey) storedCred.publicKey = storedCred.publicKey.trim();
        } catch {}

        if (!storedCred) {
            return new Response(JSON.stringify({ status: "error", error: "no stored credential" }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 验证签名
        const valid = await verifyWebAuthn(credential, storedCred, session.challenge);
        if (!valid) {
            return new Response(JSON.stringify({ status: "invalid", error: "signature verification failed" }), {
                status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 验证通过
        session.status = "authenticated";
        session.expires = now + 60000;

        return new Response(JSON.stringify({ status: "authenticated" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    // ── GET /api/auth/status?session=XXX ──
    if (request.method === "GET") {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) {
            return new Response(JSON.stringify({ error: "missing session" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const session = sessions.get(sessionId);
        if (!session || now > session.expires) {
            sessions.delete(sessionId);
            return new Response(JSON.stringify({ status: "expired" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        return new Response(JSON.stringify({ status: session.status }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    return new Response(JSON.stringify({ error: "not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

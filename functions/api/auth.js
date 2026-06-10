/**
 * Cloudflare Pages Function — 管理认证
 * 
 * POST /api/auth  {"session":"xxx","challenge":"xxx"}  → 创建会话
 * GET  /api/auth?session=xxx                          → 检查状态
 * 
 * 需要在 Cloudflare 设置环境变量:
 *   TOTP_SECRET=A5R2LMA3MWSM747R
 */

// 内存会话存储（单实例足够个人站用，会话 30 秒过期）
const sessions = new Map();

// ═══ TOTP 验证（服务端） ═══
function base32ToHex(base32) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "", hex = "";
    base32 = base32.toUpperCase().replace(/=+$/, "");
    for (let i = 0; i < base32.length; i++) {
        const val = alphabet.indexOf(base32[i]);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, "0");
    }
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        hex += parseInt(bits.substr(i, 8), 2).toString(16).padStart(2, "0");
    }
    return hex;
}

async function generateTOTP(secret, timeStep = 30) {
    const key = base32ToHex(secret);
    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / timeStep);
    const counterHex = counter.toString(16).padStart(16, "0");

    const keyBytes = new Uint8Array(key.match(/.{2}/g).map(b => parseInt(b, 16)));
    const msgBytes = new Uint8Array(counterHex.match(/.{2}/g).map(b => parseInt(b, 16)));

    const cryptoKey = await crypto.subtle.importKey(
        "raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgBytes);
    const hmac = new Uint8Array(sig);

    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    return binary % 1000000;
}

async function generateTOTPForCounter(secret, counter) {
    const key = base32ToHex(secret);
    const counterHex = counter.toString(16).padStart(16, "0");

    const keyBytes = new Uint8Array(key.match(/.{2}/g).map(b => parseInt(b, 16)));
    const msgBytes = new Uint8Array(counterHex.match(/.{2}/g).map(b => parseInt(b, 16)));

    const cryptoKey = await crypto.subtle.importKey(
        "raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgBytes);
    const hmac = new Uint8Array(sig);

    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    return binary % 1000000;
}

export async function onRequest(context) {
    const { request, env } = context;

    // 清理过期会话（每次请求时检查）
    const now = Date.now();
    for (const [sid, data] of sessions) {
        if (now > data.expires) sessions.delete(sid);
    }
    const url = new URL(request.url);

    // CORS
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    // GET — 检查会话状态
    if (request.method === "GET") {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) {
            return new Response(JSON.stringify({ error: "missing session" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const session = sessions.get(sessionId);
        if (!session || Date.now() > session.expires) {
            sessions.delete(sessionId);
            return new Response(JSON.stringify({ status: "expired" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        return new Response(JSON.stringify({ status: session.status }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    // POST — 验证并标记会话
    if (request.method === "POST") {
        let body;
        try {
            body = await request.json();
        } catch {
            return new Response(JSON.stringify({ error: "invalid json" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const { session, challenge } = body;
        if (!session || !challenge) {
            return new Response(JSON.stringify({ error: "missing fields" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 验证 TOTP challenge（允许前后各一个窗口，共90秒容忍）
        const secret = env.TOTP_SECRET;
        if (!secret) {
            return new Response(JSON.stringify({ status: "error", error: "server not configured" }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const now = Math.floor(Date.now() / 1000);
        const current = await generateTOTP(secret);
        const prev = await generateTOTPForCounter(secret, Math.floor((now - 30) / 30));
        const prev2 = await generateTOTPForCounter(secret, Math.floor((now - 60) / 30));

        const validCodes = [
            current.toString().padStart(6, "0"),
            prev.toString().padStart(6, "0"),
            prev2.toString().padStart(6, "0")
        ];

        if (!validCodes.includes(challenge)) {
            return new Response(JSON.stringify({ status: "invalid", error: "wrong code" }), {
                status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 验证通过，标记会话
        sessions.set(session, {
            status: "authenticated",
            expires: Date.now() + 60000  // 1分钟有效期
        });

        return new Response(JSON.stringify({ status: "authenticated" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

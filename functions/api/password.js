/**
 * Cloudflare Pages Function — 密码验证
 * POST /api/password  { password: "..." }
 * 环境变量: SITE_PASSWORD
 */
export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
        return new Response(JSON.stringify({ status: "error", error: "use POST" }), {
            status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ status: "error", error: "invalid json" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const pw = body.password || "";
    const expected = env.SITE_PASSWORD || "";

    if (!expected) {
        return new Response(JSON.stringify({ status: "error", error: "no password configured" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    if (pw === expected) {
        return new Response(JSON.stringify({ status: "ok" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ status: "wrong" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

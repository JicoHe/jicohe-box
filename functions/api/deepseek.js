/**
 * Cloudflare Pages Function — DeepSeek API 代理
 * 路径: /api/deepseek
 * 
 * 需要在 Cloudflare Pages 后台设置环境变量:
 *   DEEPSEEK_API_KEY=sk-your-key-here
 */
export async function onRequest(context) {
    const apiKey = context.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ error: "API key not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        const resp = await fetch("https://api.deepseek.com/user/balance", {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Accept": "application/json"
            }
        });

        const data = await resp.json();

        return new Response(JSON.stringify(data), {
            status: resp.status,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=30"
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to fetch balance" }), {
            status: 502,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }
}

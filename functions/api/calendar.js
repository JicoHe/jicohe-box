/**
 * Cloudflare Pages Function — 日程 API
 * GET  /api/calendar  → 返回 events.json
 * POST /api/calendar  → 接收新日程请求 (转发 webhook / 返回确认)
 */
export async function onRequest(context) {
    const { request, env } = context;

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    // ── GET: 读取日程 ──
    if (request.method === "GET") {
        try {
            const eventsUrl = new URL("/events.json", request.url);
            const resp = await fetch(eventsUrl);
            if (!resp.ok) throw new Error("Not found");
            const data = await resp.json();
            return new Response(JSON.stringify(data), {
                headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=120" },
            });
        } catch {
            return new Response(JSON.stringify({ updated: null, count: 0, events: [] }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
    }

    // ── POST: 新增日程 ──
    if (request.method === "POST") {
        try {
            const body = await request.json();
            const { summary, start_date, description, calendar } = body;
            if (!summary || !start_date) {
                return new Response(JSON.stringify({ error: "缺少 summary 或 start_date" }), {
                    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }

            // 如果有配置 webhook，转发过去（Hermes 本地接收 → AppleScript 写入）
            const webhookUrl = env.CALENDAR_WEBHOOK_URL;
            if (webhookUrl) {
                try {
                    await fetch(webhookUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "add_event", summary, start_date, description, calendar }),
                    });
                } catch {
                    // webhook 不通，回退到手动模式
                }
            }

            return new Response(JSON.stringify({
                status: "received",
                message: webhookUrl
                    ? "✅ 日程已提交，即将同步到日历"
                    : "📋 日程已收到。请将下方消息发给 Leon 帮你添加入日历",
                event: { summary, start_date, description, calendar },
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } catch {
            return new Response(JSON.stringify({ error: "请求格式错误" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
    }

    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
}

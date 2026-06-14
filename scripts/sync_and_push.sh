#!/bin/bash
# sync_and_push.sh — 同步 iCloud 日历 → events.json → git push
# 由 Hermes Cron Job 定时调用
set -e

WEB_DIR="$HOME/Desktop/web"
SCRIPT="$WEB_DIR/scripts/sync_calendar.py"
OUTPUT="$WEB_DIR/events.json"

cd "$WEB_DIR"

# 先 pull 最新
git pull --rebase origin main 2>/dev/null || true

# 同步日历
python3 "$SCRIPT" --days 60 --output "$OUTPUT"

# 如果有变化就 commit + push (静默，只看有没有变化)
if ! git diff --quiet events.json; then
    git add events.json
    git commit -m "sync: calendar update ($(date '+%Y-%m-%d %H:%M'))"
    git push origin main
fi
# 完全静默，无输出 = 不触发 delivery

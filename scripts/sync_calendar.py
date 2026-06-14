#!/usr/bin/env python3
"""
sync_calendar.py — 读取 iCloud 日历数据库，导出 events.json

用法:
    python3 sync_calendar.py [--days 30] [--output events.json]

Apple 时间戳: 2001-01-01 起算的秒数
"""

import sqlite3
import json
import sys
import os
from datetime import datetime, timezone, timedelta

APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
CAL_DB = os.path.expanduser("~/Library/Group Containers/group.com.apple.calendar/Calendar.sqlitedb")


def apple_to_iso(apple_ts):
    """将 Apple 时间戳转为 ISO 8601 字符串"""
    dt = APPLE_EPOCH + timedelta(seconds=apple_ts)
    return dt.isoformat()


def apple_to_readable(apple_ts):
    """转为人类可读的本地时间"""
    dt = APPLE_EPOCH + timedelta(seconds=apple_ts)
    local = dt.astimezone()
    return local.strftime("%Y-%m-%d %H:%M")


def load_events(days=60):
    """读取未来 N 天的日历事件"""
    now_unix = datetime.now(timezone.utc).timestamp()
    apple_now = now_unix - 978307200  # Unix epoch → Apple epoch
    apple_future = apple_now + days * 86400

    if not os.path.exists(CAL_DB):
        print(f"⚠️  日历数据库不存在: {CAL_DB}", file=sys.stderr)
        return []

    conn = sqlite3.connect(CAL_DB)
    conn.row_factory = sqlite3.Row

    rows = conn.execute("""
        SELECT
            ci.summary,
            ci.start_date,
            ci.end_date,
            ci.all_day,
            ci.start_tz,
            ci.description,
            ci.url,
            ci.location_id,
            c.title AS calendar_name,
            c.color AS calendar_color
        FROM CalendarItem ci
        JOIN Calendar c ON ci.calendar_id = c.ROWID
        WHERE ci.start_date >= ?
          AND ci.summary IS NOT NULL
          AND ci.summary != ''
        ORDER BY ci.start_date ASC
        LIMIT 200
    """, (apple_now,))

    events = []
    for row in rows:
        events.append({
            "summary": row["summary"],
            "start": apple_to_iso(row["start_date"]),
            "end": apple_to_iso(row["end_date"]),
            "start_readable": apple_to_readable(row["start_date"]),
            "end_readable": apple_to_readable(row["end_date"]),
            "all_day": bool(row["all_day"]),
            "timezone": row["start_tz"] if row["start_tz"] != "_float" else None,
            "calendar": row["calendar_name"],
            "color": row["calendar_color"],
            "description": row["description"],
            "url": row["url"],
        })

    conn.close()
    return events


def main():
    days = 60
    output_path = None

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--days" and i + 1 < len(args):
            days = int(args[i + 1])
            i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_path = args[i + 1]
            i += 2
        else:
            i += 1

    if output_path is None:
        output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.json")

    events = load_events(days=days)

    output = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "count": len(events),
        "events": events,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"✅ 导出 {len(events)} 条事件 → {output_path}")


if __name__ == "__main__":
    main()

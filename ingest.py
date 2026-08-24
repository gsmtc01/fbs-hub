"""수집 → SQLite 적재.

정책: 목록에 실려오는 메타데이터만 저장한다. 상세 페이지 본문은 가져오지 않고,
      링크는 항상 상명대 원문으로 내보낸다.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import collector as c
from meal_utils import meal_identity, normalize_meal_corner, resolve_meal_date

DB = Path(__file__).parent / "notices.db"
SEOUL_TZ = ZoneInfo("Asia/Seoul")


def seoul_timestamp() -> str:
    return datetime.now(SEOUL_TZ).strftime("%Y-%m-%d %H:%M:%S")

SCHEMA = """
CREATE TABLE IF NOT EXISTS notices (
    board       TEXT NOT NULL,
    key         TEXT NOT NULL,          -- 내부글은 articleNo, 외부링크(focus)는 URL
    article_no  TEXT,
    title       TEXT NOT NULL,
    summary     TEXT DEFAULT '',
    writer      TEXT DEFAULT '',        -- 부서명만 (실명은 수집 단계에서 제거)
    date        TEXT DEFAULT '',
    views       INTEGER DEFAULT 0,
    pinned      INTEGER DEFAULT 0,
    link_type   TEXT DEFAULT 'internal',
    thumbnail   TEXT,
    url         TEXT NOT NULL,          -- 항상 원본(상명대 또는 외부 언론사) 주소
    meal        TEXT DEFAULT '',         -- 식단 전용: 조식/중식/석식/간식
    day         TEXT DEFAULT '',         -- 식단 전용: 표의 요일과 날짜
    corner      TEXT DEFAULT '',         -- 식단 전용: 한식/푸드코트 등 코너
    menu_json   TEXT DEFAULT '[]',       -- 식단 전용: 메뉴 배열
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    PRIMARY KEY (board, key)
);
CREATE INDEX IF NOT EXISTS idx_date  ON notices(date DESC);
CREATE INDEX IF NOT EXISTS idx_board ON notices(board, date DESC);

CREATE TABLE IF NOT EXISTS runs (
    ts TEXT PRIMARY KEY, board TEXT, fetched INTEGER, added INTEGER, note TEXT,
    status TEXT DEFAULT 'ok', error TEXT DEFAULT '', duration_ms INTEGER DEFAULT 0
);
"""


def normalize_restaurant_records(conn: sqlite3.Connection) -> None:
    """구형 수집 날짜 기반 식단 키를 제공일 기반 키로 합치고 코너명을 정규화한다."""
    rows = conn.execute(
        "SELECT rowid, * FROM notices WHERE board='restaurant'"
    ).fetchall()
    groups: dict[str, list[tuple[sqlite3.Row, str, str, str, str]]] = {}
    for row in rows:
        title = " ".join((row["title"] or "").split())
        meal = row["meal"] or next(
            (name for name in ("조식", "중식", "석식", "간식") if title.endswith(name)),
            "",
        )
        day = row["day"] or (
            title[:-len(meal)].strip() if meal and title.endswith(meal) else title
        )
        corner = normalize_meal_corner(row["corner"] or ("한식(식판)" if row["summary"] else ""))
        served_on = resolve_meal_date(day, row["date"] or "")
        identity = meal_identity(day, meal, corner, row["date"] or "")
        groups.setdefault(identity, []).append((row, meal, day, corner, served_on))

    for identity, records in groups.items():
        winner = max(records, key=lambda record: (record[0]["last_seen"] or "", record[0]["key"]))
        winner_row, meal, day, corner, served_on = winner
        for row, _meal, _day, _corner, _served_on in records:
            if row["rowid"] != winner_row["rowid"]:
                conn.execute("DELETE FROM notices WHERE rowid=?", (row["rowid"],))
        conn.execute(
            """UPDATE notices
               SET key=?, meal=?, day=?, corner=?, date=?
               WHERE rowid=?""",
            (
                identity,
                meal,
                day,
                corner,
                served_on,
                winner_row["rowid"],
            ),
        )


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(notices)")}
    for name, definition in {
        "meal": "TEXT DEFAULT ''",
        "day": "TEXT DEFAULT ''",
        "corner": "TEXT DEFAULT ''",
        "menu_json": "TEXT DEFAULT '[]'",
    }.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE notices ADD COLUMN {name} {definition}")
    run_columns = {row[1] for row in conn.execute("PRAGMA table_info(runs)")}
    for name, definition in {
        "status": "TEXT DEFAULT 'ok'",
        "error": "TEXT DEFAULT ''",
        "duration_ms": "INTEGER DEFAULT 0",
    }.items():
        if name not in run_columns:
            conn.execute(f"ALTER TABLE runs ADD COLUMN {name} {definition}")
    normalize_restaurant_records(conn)
    conn.commit()
    return conn


def ingest_board(conn: sqlite3.Connection, key: str, limit: int = 30) -> tuple[int, int]:
    board = c.BOARDS[key]
    items = c.list_notices(key, limit=limit)
    now = seoul_timestamp()
    added = 0

    for it in items:
        # 언론 속 상명은 내부 articleNo 가 없어 외부 URL 을 키로 쓴다.
        pk = it.get("id") or it["url"]
        cur = conn.execute(
            "SELECT 1 FROM notices WHERE board=? AND key=?", (board.key, pk))
        exists = cur.fetchone() is not None

        conn.execute("""
            INSERT INTO notices (board, key, article_no, title, summary, writer, date,
                                 views, pinned, link_type, thumbnail, url, meal, day,
                                 corner, menu_json, first_seen, last_seen)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(board, key) DO UPDATE SET
                title=excluded.title, summary=excluded.summary, views=excluded.views,
                pinned=excluded.pinned, date=excluded.date, meal=excluded.meal,
                day=excluded.day, corner=excluded.corner, menu_json=excluded.menu_json,
                last_seen=excluded.last_seen
        """, (board.key, pk, it.get("id"), it["title"], it.get("summary", ""),
              it.get("writer", ""), it.get("date", ""), it.get("views", 0),
              int(it.get("pinned", False)), it.get("link_type", "internal"),
              it.get("thumbnail"), it["url"], it.get("meal", ""), it.get("day", ""),
              it.get("corner", ""), json.dumps(it.get("menu", []), ensure_ascii=False),
              now, now))
        added += 0 if exists else 1

    conn.commit()
    return len(items), added


def record_run(conn: sqlite3.Connection, key: str, fetched: int, added: int,
               status: str, error: str, duration_ms: int) -> None:
    now = seoul_timestamp()
    conn.execute(
        """INSERT OR REPLACE INTO runs
           (ts, board, fetched, added, note, status, error, duration_ms)
           VALUES (?,?,?,?,?,?,?,?)""",
        (now + "|" + key, key, fetched, added, c.BOARDS[key].name,
         status, error[:500], duration_ms),
    )
    conn.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=30, help="게시판별 수집 건수")
    ap.add_argument("--board", help="특정 게시판만")
    args = ap.parse_args()

    conn = connect()
    keys = [args.board] if args.board else c.collectable()
    tot_f = tot_a = 0
    failures = []
    for k in keys:
        started = time.monotonic()
        try:
            f, a = ingest_board(conn, k, args.limit)
            record_run(conn, k, f, a, "ok", "", int((time.monotonic() - started) * 1000))
            print(f"  {c.BOARDS[k].name:22} 수집 {f:3}건 · 신규 {a:3}건")
            tot_f, tot_a = tot_f + f, tot_a + a
        except Exception as e:
            message = str(e)
            record_run(conn, k, 0, 0, "error", message,
                       int((time.monotonic() - started) * 1000))
            failures.append(k)
            print(f"  {c.BOARDS[k].name:22} 실패: {e}")
    print(f"\n총 {tot_f}건 수집 / 신규 {tot_a}건")
    if c.EXCLUDED:
        print(f"제외됨: {', '.join(c.EXCLUDED)}")
    print("미등록: 학술정보관(robots.txt Disallow) · 기숙사3종 · IT매뉴얼 · 학생회공지 · 자료실 · Q&A · 카드뉴스")
    n = conn.execute("SELECT COUNT(*) FROM notices").fetchone()[0]
    print(f"DB 누적: {n}건 → {DB}")
    if failures:
        print(f"수집 실패로 공개 데이터 내보내기를 중단합니다: {', '.join(failures)}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()

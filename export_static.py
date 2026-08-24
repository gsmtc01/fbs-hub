"""SQLite의 공개 가능 필드만 GitHub Pages용 JSON으로 내보낸다.

본문, 담당자 실명, 첨부파일은 내보내지 않는다. 요약은 방어적으로 150자로 다시 제한한다.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from meal_utils import meal_identity, normalize_meal_corner, resolve_meal_date

ROOT = Path(__file__).resolve().parent
DEFAULT_DB = ROOT / "notices.db"
DEFAULT_OUTPUT = ROOT / "data" / "notices.json"
SUMMARY_CHARS = 150
SEOUL_TZ = ZoneInfo("Asia/Seoul")

BOARD_LABELS = {
    "univ": "상명대학교 공지사항",
    "coneng": "융합공과대학 공지사항",
    "fbs": "핀빅스 공지사항",
    "recruit": "핀빅스 채용·홍보",
    "calendar": "학사일정 및 전공일정",
    "restaurant": "학식",
    "today": "상명투데이",
    "newsletter": "상명 뉴스레터",
    "people": "상명피플",
    "focus": "언론 속 상명",
}
ORG_SUFFIX = re.compile(r"(팀|과|부|실|처|센터|대학|학부|전공|단|원|위원회|사업단|학교)$")


def safe_writer(value: str) -> str:
    """조직명만 통과시키고 사람 이름 형태는 제거한다."""
    value = " ".join((value or "").split())
    if not value:
        return ""
    return value if ORG_SUFFIX.search(value) else ""


def safe_url(value: str) -> str:
    value = (value or "").strip()
    parsed = urlparse(value)
    return value if parsed.scheme in {"http", "https"} and parsed.netloc else ""


def legacy_meal_fields(row: sqlite3.Row) -> tuple[str, str, str, list[str]]:
    """구형 DB의 식단 레코드를 공개 스키마 3 구조로 보정한다."""
    try:
        parsed = json.loads(row["menu_json"] or "[]")
        menu = parsed if isinstance(parsed, list) else []
    except (TypeError, json.JSONDecodeError):
        menu = []
    title = " ".join((row["title"] or "").split())
    meal = row["meal"] or next((name for name in ("조식", "중식", "석식", "간식")
                                if title.endswith(name)), "")
    day = row["day"] or (title[:-len(meal)].strip() if meal and title.endswith(meal) else title)
    if not menu:
        menu = [part.strip() for part in re.split(r"\s*[·/]\s*", row["summary"] or "") if part.strip()]
    corner = normalize_meal_corner(row["corner"] or ("한식(식판)" if menu else ""))
    return meal, day, corner, menu


def dedupe_restaurant_rows(rows: list[sqlite3.Row]) -> list[sqlite3.Row]:
    """같은 제공일·식사·코너를 여러 번 수집한 구형 레코드 중 최신 항목만 남긴다."""
    winners: dict[str, sqlite3.Row] = {}
    for row in rows:
        if row["board"] != "restaurant":
            continue
        meal, day, corner, _menu = legacy_meal_fields(row)
        identity = meal_identity(day, meal, corner, row["date"] or "")
        current = winners.get(identity)
        if current is None or (row["last_seen"] or "", row["key"]) > (
            current["last_seen"] or "", current["key"]
        ):
            winners[identity] = row

    winner_keys = {row["key"] for row in winners.values()}
    return [
        row for row in rows
        if row["board"] != "restaurant" or row["key"] in winner_keys
    ]


def export(db_path: Path, output_path: Path) -> dict:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        SELECT board, key, title, summary, writer, date, views, pinned,
               link_type, thumbnail, url, meal, day, corner, menu_json, last_seen
        FROM notices
        ORDER BY pinned DESC, date DESC, board, key
        """
    ).fetchall()
    run_columns = {row[1] for row in connection.execute("PRAGMA table_info(runs)")}
    latest_runs = {}
    if {"status", "error"}.issubset(run_columns):
        for run in connection.execute(
            """SELECT r.board, r.status, r.error, substr(r.ts, 1, 19) AS ts
               FROM runs r
               JOIN (SELECT board, max(ts) AS ts FROM runs GROUP BY board) latest
                 ON latest.board=r.board AND latest.ts=r.ts"""
        ):
            latest_runs[run["board"]] = dict(run)
    connection.close()
    rows = dedupe_restaurant_rows(rows)

    items = []
    for row in rows:
        url = safe_url(row["url"])
        if not url:
            continue
        summary = " ".join((row["summary"] or "").split())[:SUMMARY_CHARS]
        item = {
            "id": f'{row["board"]}:{row["key"]}',
            "board": row["board"],
            "boardLabel": BOARD_LABELS.get(row["board"], row["board"]),
            "title": " ".join(row["title"].split()),
            "summary": summary,
            "writer": safe_writer(row["writer"]),
            "date": row["date"] or "",
            "views": int(row["views"] or 0),
            "pinned": bool(row["pinned"]),
            "linkType": row["link_type"] or "internal",
            "thumbnail": safe_url(row["thumbnail"]),
            "url": url,
        }
        if row["board"] == "restaurant":
            meal, day, corner, menu = legacy_meal_fields(row)
            served_on = resolve_meal_date(day, row["date"] or "")
            item.update({
                "id": f"restaurant:{meal_identity(day, meal, corner, row['date'] or '')}",
                "date": served_on,
                "meal": meal,
                "day": day,
                "corner": corner,
                "menu": menu,
            })
        items.append(item)

    generated_at = max((row["last_seen"] for row in rows if row["last_seen"]), default="")
    if generated_at:
        generated_at = generated_at.replace(" ", "T") + "+09:00"
    else:
        generated_at = datetime.now(SEOUL_TZ).isoformat(timespec="seconds")
    sources = []
    for key, label in BOARD_LABELS.items():
        source_rows = [row for row in rows if row["board"] == key]
        updated_at = max((row["last_seen"] for row in source_rows if row["last_seen"]), default="")
        if updated_at:
            updated_at = updated_at.replace(" ", "T") + "+09:00"
        run = latest_runs.get(key, {})
        sources.append({
            "key": key,
            "label": label,
            "itemCount": len(source_rows),
            "updatedAt": updated_at,
            "status": run.get("status", "ok" if source_rows else "empty"),
            "error": run.get("error", ""),
        })

    payload = {
        "schemaVersion": 3,
        "generatedAt": generated_at,
        "summaryLimit": SUMMARY_CHARS,
        "notice": "본문과 담당자 실명은 포함하지 않습니다. 링크는 항상 원문으로 연결됩니다.",
        "sources": sources,
        "items": items,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    payload = export(args.db, args.output)
    print(f'{len(payload["items"])}건 → {args.output}')


if __name__ == "__main__":
    main()

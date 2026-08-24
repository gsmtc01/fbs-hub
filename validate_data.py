"""배포 전 공개 JSON의 출처·개인정보·스키마 정책을 검증한다."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse

EXPECTED_BOARDS = (
    "univ", "coneng", "fbs", "recruit", "calendar", "restaurant",
    "today", "newsletter", "people", "focus",
)
ORG_SUFFIX = re.compile(r"(팀|과|부|실|처|센터|대학|학부|전공|단|원|위원회|사업단|학교)$")
FORBIDDEN_FIELDS = {"content", "body", "attachments", "files"}
EMAIL = re.compile(r"(?i)(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]{2,}(?![\w.-])")
MOBILE = re.compile(r"(?<!\d)01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)")
RESIDENT_NUMBER = re.compile(r"(?<!\d)\d{6}[\s-]?[1-4]\d{6}(?!\d)")
HIGH_RISK_IDENTIFIERS = {
    "이메일 주소": EMAIL,
    "휴대전화 번호": MOBILE,
    "주민등록번호 형태": RESIDENT_NUMBER,
}


def validate(path: Path) -> list[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    errors: list[str] = []
    items = payload.get("items")
    if payload.get("schemaVersion") != 3:
        errors.append("schemaVersion은 3이어야 합니다.")
    if not isinstance(items, list):
        return errors + ["items가 배열이 아닙니다."]

    ids: set[str] = set()
    boards: set[str] = set()
    for index, item in enumerate(items):
        prefix = f"items[{index}]"
        boards.add(item.get("board", ""))
        item_id = item.get("id", "")
        if not item_id or item_id in ids:
            errors.append(f"{prefix}: ID가 없거나 중복입니다: {item_id}")
        ids.add(item_id)
        if FORBIDDEN_FIELDS.intersection(item):
            errors.append(f"{prefix}: 공개 금지 필드가 있습니다.")
        for field in ("title", "summary", "writer"):
            value = str(item.get(field, "") or "")
            for label, pattern in HIGH_RISK_IDENTIFIERS.items():
                if pattern.search(value):
                    errors.append(f"{prefix}.{field}: {label}가 포함되어 있습니다.")
        if len(item.get("summary", "")) > 150:
            errors.append(f"{prefix}: 요약이 150자를 초과합니다.")
        writer = item.get("writer", "")
        if writer and not ORG_SUFFIX.search(writer):
            errors.append(f"{prefix}: 조직명으로 확인되지 않는 작성자입니다.")
        parsed = urlparse(item.get("url", ""))
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            errors.append(f"{prefix}: 올바르지 않은 원문 URL입니다.")
        if item.get("board") == "restaurant":
            if not item.get("day") or not item.get("meal") or not item.get("corner"):
                errors.append(f"{prefix}: 구조화된 식단 필드가 비어 있습니다.")
            if not isinstance(item.get("menu"), list) or not item.get("menu"):
                errors.append(f"{prefix}: 식단 메뉴 배열이 비어 있습니다.")

    missing = set(EXPECTED_BOARDS) - boards
    if missing:
        errors.append(f"필수 출처가 없습니다: {', '.join(sorted(missing))}")
    sources = payload.get("sources", [])
    if {source.get("key") for source in sources} != set(EXPECTED_BOARDS):
        errors.append("sources 메타데이터가 10개 출처와 일치하지 않습니다.")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path, nargs="?", default=Path("data/notices.json"))
    args = parser.parse_args()
    errors = validate(args.path)
    if errors:
        for error in errors:
            print(f"[FAIL] {error}")
        raise SystemExit(1)
    print(f"[OK] 공개 데이터 정책 및 10개 출처 검증 완료: {args.path}")


if __name__ == "__main__":
    main()

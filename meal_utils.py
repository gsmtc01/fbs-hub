"""학식 코너명과 날짜 기반 식단 식별자를 정규화한다."""
from __future__ import annotations

import re
from datetime import date

CORNER_ALIASES = {
    "한식": "한식(식판)",
}
MEAL_CODES = {
    "조식": "B",
    "중식": "L",
    "석식": "D",
    "간식": "S",
}


def normalize_meal_corner(value: str) -> str:
    """원문 코너명을 보존하되 확인된 구형 별칭만 현재 명칭으로 통일한다."""
    corner = " ".join((value or "").split())
    return CORNER_ALIASES.get(corner, corner)


def resolve_meal_date(day_label: str, observed_on: str) -> str:
    """요일 표기의 월·일을 수집 기준일과 가장 가까운 실제 날짜로 변환한다."""
    match = re.search(r"(\d{1,2})[./](\d{1,2})", day_label or "")
    try:
        anchor = date.fromisoformat(observed_on)
    except (TypeError, ValueError):
        return observed_on or ""
    if not match:
        return anchor.isoformat()

    month, day = map(int, match.groups())
    candidates = []
    for year in (anchor.year - 1, anchor.year, anchor.year + 1):
        try:
            candidates.append(date(year, month, day))
        except ValueError:
            continue
    return min(candidates, key=lambda candidate: abs(candidate - anchor)).isoformat()


def meal_identity(day_label: str, meal: str, corner: str, observed_on: str) -> str:
    """재수집 날짜와 무관한 식단 기본 키를 만든다."""
    served_on = resolve_meal_date(day_label, observed_on)
    meal_key = MEAL_CODES.get(meal, re.sub(r"\s+", "", meal or "") or "meal")
    normalized_corner = normalize_meal_corner(corner)
    corner_key = re.sub(r"[^0-9A-Za-z가-힣]+", "-", normalized_corner).strip("-") or "corner"
    return f"{served_on}-{meal_key}-{corner_key}"

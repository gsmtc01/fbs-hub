"""상명대 공지사항 통합 수집기 (프로토타입)

두 가지 게시판 엔진을 하나의 스키마로 정규화한다.
  - smart  : www.smu.ac.kr / seng.smu.ac.kr 계열 (.do, mode=list|view)
  - sponge : lib.smu.ac.kr 학술정보관 (/Board?n=notice)
"""
from __future__ import annotations

import html
import json
import random
import re
import time
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict, field
from datetime import datetime
from zoneinfo import ZoneInfo

from meal_utils import meal_identity, normalize_meal_corner, resolve_meal_date

UA = ("FbsHub/1.0 (unofficial SMU student project; "
      "contact via the project GitHub Issues page)")
SEOUL_TZ = ZoneInfo("Asia/Seoul")


@dataclass
class Board:
    key: str
    name: str
    engine: str          # "smart" | "sponge"
    url: str
    categories: dict = field(default_factory=dict)


BOARDS = {
    # 순서 = 사이트 노출 순서 (사용자 확정)
    "univ": Board("univ", "상명대학교 공지사항", "smart",
                  "https://www.smu.ac.kr/kor/life/notice.do"),
    "coneng": Board("coneng", "융합공과대학 공지사항", "smart",
                    "https://seng.smu.ac.kr/coneng/community/notice.do"),
    "fbs": Board("fbs", "핀빅스 공지사항", "smart",
                 "https://www.smu.ac.kr/fbs/community/notice.do"),
    "recruit": Board("recruit", "핀빅스 채용·홍보", "smart",
                     "https://www.smu.ac.kr/fbs/community/intellirecruit.do"),
    "calendar": Board("calendar", "학사일정 및 전공일정", "calendar",
                      "https://fbs.smu.ac.kr/fbs/admission/calendar.do"),
    "restaurant": Board("restaurant", "학식", "restaurant",
                        "https://www.smu.ac.kr/kor/life/restaurantView.do"),
    "today": Board("today", "상명투데이", "webzine",
                   "https://www.smu.ac.kr/webzine/today.do"),
    "newsletter": Board("newsletter", "상명 뉴스레터", "webzine",
                        "https://www.smu.ac.kr/webzine/newsletter.do"),
    "people": Board("people", "상명피플", "webzine",
                    "https://www.smu.ac.kr/webzine/sm-people.do"),
    "focus": Board("focus", "언론 속 상명", "webzine",
                   "https://www.smu.ac.kr/webzine/focus.do"),
}

# 캘린더 API boardNo (fbs 캘린더 페이지 hidden input 에서 확인)
CALENDAR_BOARDS = {"85": "학사일정", "983": "행사일정", "3245": "핀빅스 전공일정"}


# 서버가 연속 요청에 연결을 끊는 일이 있다. 간격을 두고 재시도한다(AGENTS.md 1-6).
RETRIES = 3
BACKOFF = 3.0
THROTTLE = 1.0      # 매 요청 사이 최소 간격(초)
JITTER = 0.25       # 정각에 같은 간격의 요청이 반복되지 않도록 작은 지연을 더한다.
_last_call = [0.0]


def _throttle() -> None:
    gap = time.monotonic() - _last_call[0]
    if gap < THROTTLE:
        time.sleep(THROTTLE - gap + random.uniform(0, JITTER))
    _last_call[0] = time.monotonic()


def _status_code(error: Exception) -> int | None:
    response = getattr(error, "response", None)
    return getattr(response, "status_code", None) or getattr(error, "code", None)


def _retry_delay(error: Exception, attempt: int) -> float | None:
    """재시도할 오류의 대기 시간을 반환한다. 영구적인 4xx 오류는 재시도하지 않는다."""
    status = _status_code(error)
    if status and status not in {408, 425, 429} and status < 500:
        return None
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None) or getattr(error, "headers", {}) or {}
    retry_after = headers.get("Retry-After")
    if retry_after and str(retry_after).isdigit():
        return min(120.0, float(retry_after))
    return BACKOFF * (attempt + 1) + random.uniform(0, JITTER)


def fetch(url: str) -> str:
    """requests 우선(certifi 신뢰저장소). 없으면 stdlib으로 폴백."""
    last = None
    for attempt in range(RETRIES):
        _throttle()
        try:
            try:
                import requests
                r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
                r.raise_for_status()
                r.encoding = "utf-8"
                return r.text
            except ImportError:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    return resp.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            if attempt < RETRIES - 1:
                delay = _retry_delay(e, attempt)
                if delay is None:
                    raise
                time.sleep(delay)
    raise last


def post_json(url: str, data: dict) -> dict:
    """fetch() 와 같은 이유로 requests 를 우선 쓴다.
    stdlib urllib 은 이 호스트의 인증서 체인에서 검증에 실패한다."""
    last = None
    for attempt in range(RETRIES):
        _throttle()
        try:
            try:
                import requests
                r = requests.post(url, data=data, timeout=20, headers={
                    "User-Agent": UA, "X-Requested-With": "XMLHttpRequest"})
                r.raise_for_status()
                return r.json()
            except ImportError:
                req = urllib.request.Request(
                    url, data=urllib.parse.urlencode(data).encode(),
                    headers={"User-Agent": UA, "X-Requested-With": "XMLHttpRequest"})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last = e
            if attempt < RETRIES - 1:
                delay = _retry_delay(e, attempt)
                if delay is None:
                    raise
                time.sleep(delay)
    raise last


def norm_date(d: str) -> str:
    """게시판마다 2026-08-19 / 26-02-10 / 2026.08.11 이 섞여 나온다."""
    d = d.strip().replace(".", "-").strip("-")
    m = re.match(r"^(\d{2})-(\d{2})-(\d{2})$", d)
    return f"20{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else d


def clean(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


# ---------------------------------------------------------------- 수집 정책
# 학술정보관(lib.smu.ac.kr)은 robots.txt 가 Disallow: / 로 전면 차단이라 제외한다.
# 허락을 받으면 이 집합에서 빼면 다시 포함된다.
# 학술정보관(lib.smu.ac.kr)은 robots.txt 가 Disallow: / 라 등록 자체를 하지 않았다.
# 기숙사 3종·IT매뉴얼·학생회공지·자료실·Q&A·카드뉴스는 검토 후 제외(갱신 정지/중복).
EXCLUDED: set[str] = set()

# 본문 전문은 저장하지 않는다. 목록에 실려오는 요약도 발췌 길이로 자른다.
# (상명투데이는 목록 dd 에 기사 '전문'이 실려 오므로 자르지 않으면 전문을 그대로 복제하게 된다.)
SUMMARY_CHARS = 150

_ORG_SUFFIX = ("팀", "과", "부", "실", "원", "처", "관", "대학", "학부", "센터", "위원회", "사업단")


def excerpt(text: str, limit: int = SUMMARY_CHARS) -> str:
    text = clean(text)
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def scrub_writer(name: str) -> str:
    """담당자 실명은 저장하지 않고 부서명만 남긴다.

    공개된 정보라도 제3자 사이트 재게시는 개인정보 처리에 해당한다.
    조직명 접미사가 없는 2~4자 한글은 개인명으로 보고 버린다.
    """
    name = clean(name)
    if not name:
        return ""
    if name.endswith(_ORG_SUFFIX):
        return name
    if re.fullmatch(r"[가-힣]{2,4}", name):
        return ""
    return name


def collectable() -> list[str]:
    return [k for k in BOARDS if k not in EXCLUDED]


# ---------------------------------------------------------------- smart 엔진
ITEM_RE = re.compile(
    r'<dl class="board-thumb-content-wrap[^"]*?(?P<pin>noti)?">(?P<body>.*?)</dl>',
    re.S)


def parse_smart(page: str, board: Board) -> list[dict]:
    """두 가지 목록 변형을 모두 처리한다.

    v1 (coneng/fbs) : dt > a[title="... 자세히 보기"]
    v2 (univ)       : dt > table 안에 캠퍼스 배지 + [분류] + 제목이 분리된 형태
    """
    out = []
    matches = list(ITEM_RE.finditer(page))
    # 항목 사이 구간(= 첨부파일 list-file 블록이 있는 곳)의 경계를 미리 계산한다.
    bounds = [matches[i + 1].start() if i + 1 < len(matches) else len(page)
              for i in range(len(matches))]
    for idx, m in enumerate(matches):
        b = m.group("body")
        dt = re.search(r'<dt class="board-thumb-content-title.*?</dt>', b, re.S)
        dt = dt.group(0) if dt else b

        no = re.search(r"articleNo=(\d+)", html.unescape(dt))
        if not no:
            continue
        article_no = no.group(1)

        titled = re.search(r'title="(.*?)\s*자세히 보기"', dt, re.S)
        if titled:
            title = clean(titled.group(1))
        else:
            # v2: 마지막 <a> 의 텍스트가 실제 제목
            anchors = re.findall(r"<a\s[^>]*>(.*?)</a>", dt, re.S)
            body_txt = [clean(re.sub(r'<span class="(cmp|cate)[^"]*">.*?</span>', "", a, flags=re.S))
                        for a in anchors]
            title = next((t for t in reversed(body_txt) if t), "")

        campus = re.search(r'<span class="cmp[^"]*">(.*?)</span>', dt, re.S)
        cate = re.search(r'<span class="cate">\s*\[?(.*?)\]?\s*</span>', dt, re.S)

        def field_of(cls):
            f = re.search(r'class="board-thumb-content-%s">(.*?)</li>' % cls, b, re.S)
            if not f:
                return ""
            return clean(re.sub(r'<span class="(hide|seq)">.*?</span>', "", f.group(1), flags=re.S))

        tail = page[m.end(): bounds[idx]]
        attachments = [
            {"name": clean(nm), "attach_no": an,
             "url": f"{board.url}?mode=download&articleNo={article_no}&attachNo={an}"}
            for an, nm in re.findall(
                r'data-attach-no="(\d+)"[^>]*href="\?mode=download[^"]*"[^>]*>(.*?)</a>',
                tail, re.S)]

        out.append({
            "board": board.key,
            "board_name": board.name,
            "id": article_no,
            "title": title,
            "category": clean(cate.group(1)) if cate else None,
            "campus": clean(campus.group(1)) if campus else None,
            "writer": scrub_writer(field_of("writer")),
            "date": norm_date(field_of("date")),
            "views": int((field_of("views") or "0").replace(",", "")),
            "pinned": bool(m.group("pin")),
            "attachments": attachments,
            "url": f"{board.url}?mode=view&articleNo={article_no}",
        })
    return out


def list_smart(board: Board, limit=20, offset=0, category=None, query=None) -> list[dict]:
    p = {"mode": "list", "articleLimit": limit, "article.offset": offset}
    if category:
        p["srCategoryId1"] = board.categories.get(category, category)
    if query:
        p.update({"srSearchKey": "article_title", "srSearchVal": query})
    return parse_smart(fetch(f"{board.url}?{urllib.parse.urlencode(p)}"), board)


def view_smart(board: Board, article_no: str) -> dict:
    h = fetch(f"{board.url}?mode=view&articleNo={article_no}")
    t = re.search(r'<div class="board-view-title-wrap">\s*<h4>(.*?)</h4>', h, re.S)
    c = re.search(r'<div class="board-view-content-wrap[^"]*">(.*?)<!--', h, re.S) \
        or re.search(r'<div class="fr-view">(.*?)</div>\s*</div>', h, re.S)
    # 주의: 이 CMS는 상세 페이지에 첨부 링크를 노출하지 않는다.
    #       첨부는 목록 페이지의 list-file 블록에서만 얻을 수 있다.
    return {"id": article_no, "board": board.key,
            "title": clean(t.group(1)) if t else "",
            "content": clean(c.group(1))[:100000] if c else "",
            "url": f"{board.url}?mode=view&articleNo={article_no}"}


# -------------------------------------------------------------- calendar 엔진
CAL_API = "https://fbs.smu.ac.kr/app/common/selectDataList.do"


def list_calendar(board: Board, year: int | None = None, **_) -> list[dict]:
    """학사일정은 게시판이 아니라 JSON API 다.

    페이지의 tbody 는 비어 있고 app.bachelor_calendar.calendar.js 가 이 API 로 채운다.
    year 를 빼고 부르면 0건이 돌아오므로 반드시 넣는다.
    """
    year = year or datetime.now(SEOUL_TZ).year
    rows = post_json(CAL_API, {
        "sqlId": "jw.Article.selectCalendarArticle",
        "modelNm": "list",
        "jsonStr": json.dumps({"year": str(year),
                               "bachelorBoardNoList": list(CALENDAR_BOARDS)}),
    }).get("list") or []

    out = []
    for x in rows:
        out.append({
            "board": board.key, "board_name": board.name,
            "id": str(x["articleNo"]),
            "title": clean(x.get("articleTitle", "")),
            "summary": "",
            # etcChar4/5 = 학년도/학기, etcChar6/7 = 시작일/종료일
            "start": x.get("etcChar6", ""), "end": x.get("etcChar7", ""),
            "date": x.get("etcChar6", ""),
            "category": CALENDAR_BOARDS.get(str(x.get("boardNo")), ""),
            "term": x.get("etcChar5", ""), "acad_year": x.get("etcChar4", ""),
            "writer": "", "views": 0, "thumbnail": None,
            "link_type": "internal", "url": board.url,
        })
    out.sort(key=lambda r: r["start"] or "")
    return out


# ------------------------------------------------------------ restaurant 엔진
MEALS = {"B": "조식", "L": "중식", "D": "석식", "S": "간식"}


def list_restaurant(board: Board, date: str | None = None, **_) -> list[dict]:
    """주간 식단표. 게시판이 아니라 요일 x 코너 표라 레코드 모양이 다르다."""
    date = date or datetime.now(SEOUL_TZ).date().isoformat()
    out = []
    for code, meal in MEALS.items():
        page_url = f"{board.url}?" + urllib.parse.urlencode(
            {"mode": "menuList", "srMealCategory": code, "srDt": date})
        page = fetch(page_url)
        # 페이지 상단 학사일정 팝업에도 <table><tbody> 가 있고 그쪽이 비어 있다.
        # 반드시 식단표(class="smu-table tb-w150")로 범위를 좁힌 뒤 파싱한다.
        tbl = re.search(r'<table[^>]*class="smu-table tb-w150".*?</table>', page, re.S)
        if not tbl:
            continue
        tbl = tbl.group(0)
        days = [d for d in (clean(x) for x in
                re.findall(r'<th scope="col"[^>]*>(.*?)</th>', tbl, re.S)) if d]
        body = re.search(r"<tbody>(.*?)</tbody>", tbl, re.S)
        if not body:
            continue
        for row in re.finditer(r"<tr>(.*?)</tr>", body.group(1), re.S):
            r = row.group(1)
            corner_match = re.search(r'<th scope="row">\s*(.*?)\s*</th>', r, re.S)
            corner = normalize_meal_corner(clean(corner_match.group(1)) if corner_match else "")
            for i, cell in enumerate(re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)):
                items = [clean(li) for li in re.findall(r"<li>(.*?)</li>", cell, re.S)]
                if not items:
                    continue
                day = days[i] if i < len(days) else ""
                out.append({
                    "board": board.key, "board_name": board.name,
                    "id": meal_identity(day, meal, corner, date),
                    "meal": meal, "day": day,
                    "corner": corner,
                    "menu": items,
                    "title": f"{day} {meal}".strip(),
                    "summary": " / ".join(items),
                    "date": resolve_meal_date(day, date),
                    "writer": "", "views": 0, "thumbnail": None,
                    "link_type": "internal", "url": page_url,
                })
    return out


# -------------------------------------------------------------- cardlist 엔진
def total_count(page: str) -> int | None:
    """일부 스킨은 목록 상단에 'Total N' 을 노출한다."""
    m = re.search(r"Total\s*<span>([\d,]+)</span>", page)
    return int(m.group(1).replace(",", "")) if m else None


def list_cardlist(board: Board, limit=10, offset=0, query=None) -> list[dict]:
    """boardTy=thumb2. 목록에 날짜/작성자/조회수가 아예 렌더링되지 않는다."""
    p = {"mode": "list", "articleLimit": limit, "article.offset": offset}
    if query:
        p.update({"srSearchKey": "article_title", "srSearchVal": query})
    page = fetch(f"{board.url}?{urllib.parse.urlencode(p)}")
    out = []
    for m in re.finditer(r'<div class="board-notice-box">(.*?)</div>\s*</li>', page, re.S):
        b = m.group(1)
        no = re.search(r"articleNo=(\d+)", html.unescape(b))
        if not no:
            continue
        img = re.search(r'<img[^>]*src="([^"]+)"', b)
        title = re.search(r'class="board-notice-title-box">\s*<a[^>]*>(.*?)</a>', b, re.S)
        sub = re.search(r'class="board-text-box">\s*<a[^>]*>(.*?)</a>', b, re.S)
        out.append({
            "board": board.key, "board_name": board.name,
            "id": no.group(1),
            "title": clean(title.group(1)) if title else "",
            "summary": excerpt(sub.group(1)) if sub else "",
            "thumbnail": urllib.parse.urljoin(board.url, html.unescape(img.group(1))) if img else None,
            "writer": "", "date": "", "views": 0,
            "link_type": "internal",
            "url": f"{board.url}?mode=view&articleNo={no.group(1)}",
        })
    return out


# --------------------------------------------------------------- webzine 엔진
# 주의: 항목 <li> 안에 메타용 <li> 가 중첩돼 있어 <li>...</li> 로 자르면 날짜/조회수가 잘려나간다.
#       dl 출현 위치를 기준으로 구간을 직접 계산한다.
WZ_ANCHOR_RE = re.compile(r'<dl class="board-thumb-content-wrap')


def _wz_meta(b: str, cls: str) -> str:
    m = re.search(r'class="board-thumb-content-%s">(.*?)</li>' % cls, b, re.S)
    return clean(re.sub(r'<span class="hide">.*?</span>', "", m.group(1), flags=re.S)) if m else ""


def parse_webzine(page: str, board: Board) -> list[dict]:
    """웹진 목록 3변형 처리.

    thumb02(today)/newsletter : li > a.board-list-thumb + dl.board-thumb-content-wrap
    webzine-list(focus)       : dl 만 있고 링크가 외부 언론사 URL
    thumb01(people)           : b-photo-img-box / b-photo-con-box 포토형, 메타 없음
    """
    out = []

    # 포토형(상명피플)은 마크업이 완전히 다르다.
    if "b-n-photo-wrap" in page:
        for m in re.finditer(r'<li[^>]*>\s*<div class="b-photo-img-box">(.*?)</li>\s*</li>|'
                             r'<li[^>]*>\s*<div class="b-photo-img-box">(.*?)(?=<li[^>]*>\s*<div class="b-photo-img-box">|</ul>)',
                             page, re.S):
            b = m.group(1) or m.group(2) or ""
            no = re.search(r"articleNo=(\d+)", html.unescape(b))
            if not no:
                continue
            img = re.search(r'<img[^>]*src="([^"]+)"', b)
            texts = [t for t in (clean(x) for x in re.findall(r"<a[^>]*>(.*?)</a>", b, re.S)) if t]

            # 메타 li 는 작성자와 작성일이 b-photo-con-date 클래스를 함께 쓴다(템플릿 오류).
            # 클래스가 아니라 <span class="hide"> 라벨로 구분해야 한다.
            meta = {}
            for li in re.finditer(r'<li class="b-photo-con-[a-z]+">\s*'
                                  r'<span class="hide">(.*?)</span>(.*?)</li>', b, re.S):
                meta[clean(li.group(1))] = clean(li.group(2))

            out.append({
                "board": board.key, "board_name": board.name,
                "id": no.group(1),
                "title": texts[0] if texts else "",
                "summary": excerpt(texts[-1]) if len(texts) > 1 else "",
                "thumbnail": urllib.parse.urljoin(board.url, html.unescape(img.group(1))) if img else None,
                "writer": scrub_writer(meta.get("작성", "")),
                "date": norm_date(meta.get("작성일", "")),
                "views": int((meta.get("조회수", "0") or "0").replace(",", "")),
                "link_type": "internal",
                "url": f"{board.url}?mode=view&articleNo={no.group(1)}",
            })
        return out

    anchors = list(WZ_ANCHOR_RE.finditer(page))
    for idx, m in enumerate(anchors):
        # 썸네일 <a> 가 dl 앞에 있으므로 항목 <li> 시작까지 거슬러 올라간다.
        start = page.rfind("<li", 0, m.start())
        end = anchors[idx + 1].start() if idx + 1 < len(anchors) else len(page)
        b = page[start if start != -1 else m.start(): end]
        if "board-thumb-content-title" not in b:
            continue
        a = re.search(r'<dt class="board-thumb-content-title">\s*<a href="([^"]+)"[^>]*>(.*?)</a>',
                      b, re.S)
        if not a:
            continue
        href = html.unescape(a.group(1))
        external = href.startswith("http")
        no = re.search(r"articleNo=(\d+)", href)
        # 운영자가 URL 칸에 제목을 붙여넣은 항목이 실제로 섞여 있다(언론 속 상명).
        # 링크가 성립하지 않으므로 목록 주소로 되돌리고 broken 으로 표시한다.
        broken = not external and not no

        img = re.search(r'<a class="board-list-thumb[^"]*"[^>]*>\s*<img[^>]*src="([^"]+)"', b, re.S)
        summ = re.search(r'<dd class="board-thumb-content">\s*<a[^>]*>(.*?)</a>', b, re.S)

        out.append({
            "board": board.key, "board_name": board.name,
            # 언론 속 상명은 내부 게시글이 아니라 외부 기사 링크라 articleNo 가 없다.
            "id": no.group(1) if no else None,
            "title": clean(a.group(2)),
            "summary": excerpt(summ.group(1)) if summ else "",
            "thumbnail": urllib.parse.urljoin(board.url, html.unescape(img.group(1))) if img else None,
            "writer": scrub_writer(_wz_meta(b, "writer")),
            "date": norm_date(_wz_meta(b, "date")),
            "views": int((_wz_meta(b, "views") or "0").replace(",", "")),
            "link_type": "broken" if broken else ("external" if external else "internal"),
            "url": board.url if broken else (
                href if external else f"{board.url}?mode=view&articleNo={no.group(1)}"),
        })
    return out


def list_webzine(board: Board, limit=10, offset=0, query=None) -> list[dict]:
    p = {"mode": "list", "articleLimit": limit, "article.offset": offset}
    if query:
        p.update({"srSearchKey": "article_title", "srSearchVal": query})
    return parse_webzine(fetch(f"{board.url}?{urllib.parse.urlencode(p)}"), board)


def view_webzine(board: Board, article_no: str) -> dict:
    """상세도 두 갈래다.

    thumb01/02 (today, people) : span.title + div.b-view-con-box, 메타는 b-thumb-con-*
    newsletter                 : h4 + div.board-view-content-wrap (큐레이션 지면)
    """
    h = fetch(f"{board.url}?mode=view&articleNo={article_no}")

    t = (re.search(r'<span class="title">\s*(.*?)\s*</span>', h, re.S)
         or re.search(r'<div class="board-view-title-wrap">\s*<h4>\s*(.*?)\s*</h4>', h, re.S))

    c = re.search(r'<div class="(?:b-view-con-box|board-view-content-wrap[^"]*)">(.*?)'
                  r'(?:<ul class="board-quick-menu"|<div class="b-navi-wrap"|<div class="board-view-btn)',
                  h, re.S)
    body = c.group(1) if c else ""

    def meta(*classes):
        for cls in classes:
            m = re.search(r'class="%s">(.*?)</li>' % cls, h, re.S)
            if m:
                return clean(re.sub(r'<span class="hide">.*?</span>', "", m.group(1), flags=re.S))
        return ""

    imgs = [urllib.parse.urljoin(board.url, html.unescape(u))
            for u in re.findall(r'<img[^>]*src="([^"]+)"', body)]
    # 뉴스레터는 원문이 아니라 상명투데이 기사들을 엮은 큐레이션 지면이다.
    refs = sorted(set(re.findall(r"articleNo=(\d+)", html.unescape(body))))

    return {"id": article_no, "board": board.key,
            "title": clean(t.group(1)) if t else "",
            "writer": meta("board-thumb-content-writer"),
            "date": norm_date(meta("b-thumb-con-date", "board-thumb-content-date")),
            "views": int((meta("b-thumb-con-views", "board-thumb-content-views") or "0").replace(",", "")),
            "content": clean(body)[:100000],
            "images": imgs,
            "linked_articles": refs if board.key == "newsletter" else [],
            "url": f"{board.url}?mode=view&articleNo={article_no}"}


# --------------------------------------------------------------- sponge 엔진
SP_RE = re.compile(r'<dl class="onroad-board onroad-board-\d+">(.*?)</dl>', re.S)


def list_sponge(board: Board, page=1, query=None, n="notice") -> list[dict]:
    p = {"n": n, "p": page}
    if query:
        p.update({"t": "제목", "board_q": query})
    h = fetch(f"{board.url}?{urllib.parse.urlencode(p)}")
    out = []
    for m in SP_RE.finditer(h):
        b = m.group(1)
        a = re.search(r'<a href="(/Board/Detail/(\d+)\?[^"]*)">(.*?)</a>', b, re.S)
        if not a:
            continue
        raw = a.group(3)
        cat = re.search(r'<span class="btn btn-xs[^"]*">(.*?)</span>', raw)
        num = re.search(r'onroad-board-number">(\d+)', b)
        writer = re.search(r'<span>글쓴이 </span>(.*?)<span>', b, re.S)
        views = re.search(r'조회수\s*</span>\s*([\d,]+)', b)
        date = re.search(r'게시일</span>\s*([\d.]+)', b)
        out.append({
            "board": board.key, "board_name": board.name,
            "id": a.group(2),
            "seq": int(num.group(1)) if num else None,
            "category": clean(cat.group(1)) if cat else None,
            "title": clean(re.sub(r'<span class="btn.*?</span>', "", raw, flags=re.S)),
            "writer": scrub_writer(writer.group(1)) if writer else "",
            "date": norm_date(date.group(1)) if date else "",
            "views": int(views.group(1).replace(",", "")) if views else 0,
            "pinned": "fa-thumbtack" in b,
            "url": f"https://lib.smu.ac.kr{a.group(1)}",
        })
    return out


def view_sponge(board: Board, doc_id: str, n: str = "notice") -> dict:
    h = fetch(f"https://lib.smu.ac.kr/Board/Detail/{doc_id}?n={n}")
    t = re.search(r'<h4 class="pull-left first">(.*?)</h4>', h, re.S)
    c = re.search(r'<div class="sponge-panel-white-remark[^"]*">(.*?)</div>\s*<div', h, re.S)
    files = [{"name": clean(nm), "url": urllib.parse.urljoin("https://lib.smu.ac.kr", html.unescape(u))}
             for u, nm in re.findall(r'href="(/Upload/[^"]+)"[^>]*>(.*?)</a>', h, re.S)]
    return {"id": doc_id, "board": board.key,
            "title": clean(t.group(1)) if t else "",
            "content": clean(c.group(1))[:100000] if c else "",
            "attachments": files,
            "url": f"https://lib.smu.ac.kr/Board/Detail/{doc_id}?n={n}"}


def get_notice(board_key: str, notice_id: str) -> dict:
    b = BOARDS[board_key]
    return _VIEW[b.engine](b, notice_id)


# ------------------------------------------------------------------ 통합 API
_LIST = {"smart": list_smart, "webzine": list_webzine,
         "calendar": list_calendar, "restaurant": list_restaurant}
_VIEW = {"smart": view_smart, "webzine": view_webzine}


def list_notices(board_key: str, **kw) -> list[dict]:
    b = BOARDS[board_key]
    return _LIST[b.engine](b, **kw)


if __name__ == "__main__":
    import sys
    result = {}
    for key in BOARDS:
        try:
            items = list_notices(key, **({"page": 1} if key == "library" else {"limit": 5}))
            result[key] = items[:5]
            print(f"[OK] {BOARDS[key].name}: {len(items)}건 파싱", file=sys.stderr)
            for it in items[:3]:
                print(f"     - {it['date']} | {it['title'][:45]} | 조회 {it['views']}", file=sys.stderr)
        except Exception as e:
            print(f"[FAIL] {key}: {e}", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False, indent=2))

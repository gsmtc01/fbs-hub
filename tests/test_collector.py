from __future__ import annotations

import unittest
from unittest.mock import patch

import collector


SMART_HTML = """
<dl class="board-thumb-content-wrap">
  <dt class="board-thumb-content-title"><a href="?mode=view&amp;articleNo=123" title="테스트 공지 자세히 보기">테스트 공지</a></dt>
  <li class="board-thumb-content-writer"><span class="hide">작성자</span>정보통신팀</li>
  <li class="board-thumb-content-date"><span class="hide">작성일</span>2026-08-23</li>
  <li class="board-thumb-content-views"><span class="hide">조회수</span>12</li>
</dl>
"""

WEBZINE_HTML = """
<li>
  <a class="board-list-thumb"><img src="/thumb.jpg"></a>
  <dl class="board-thumb-content-wrap">
    <dt class="board-thumb-content-title"><a href="?mode=view&amp;articleNo=456">웹진 제목</a></dt>
    <dd class="board-thumb-content"><a>짧은 소개</a></dd>
    <li class="board-thumb-content-writer"><span class="hide">작성자</span>홍보팀</li>
    <li class="board-thumb-content-date"><span class="hide">작성일</span>2026-08-22</li>
    <li class="board-thumb-content-views"><span class="hide">조회수</span>7</li>
  </dl>
</li>
"""

PEOPLE_HTML = """
<ul class="b-n-photo-wrap">
  <li><div class="b-photo-img-box">
    <a href="?mode=view&amp;articleNo=789">상명피플 제목</a><img src="/person.jpg">
    <li class="b-photo-con-date"><span class="hide">작성</span>홍보팀</li>
    <li class="b-photo-con-date"><span class="hide">작성일</span>2026.08.21</li>
    <li class="b-photo-con-views"><span class="hide">조회수</span>5</li>
  </li></li>
</ul>
"""

FOCUS_HTML = """
<li><dl class="board-thumb-content-wrap">
  <dt class="board-thumb-content-title"><a href="https://news.example/article">언론 기사</a></dt>
  <li class="board-thumb-content-date"><span class="hide">작성일</span>2026-08-20</li>
</dl></li>
"""

MEAL_HTML = """
<table class="smu-table tb-w150">
  <thead><tr><th scope="col">월(08.24)</th></tr></thead>
  <tbody>
    <tr><th scope="row">한식</th><td><ul><li>잡곡밥</li><li>된장찌개</li></ul></td></tr>
    <tr><th scope="row">푸드코트</th><td><ul><li>볶음밥</li><li>샐러드</li></ul></td></tr>
  </tbody>
</table>
"""


class CollectorRegressionTest(unittest.TestCase):
    def test_five_smart_boards(self):
        for key in ("univ", "coneng", "fbs", "recruit", "cs_recruit"):
            with self.subTest(board=key), patch("collector.fetch", return_value=SMART_HTML):
                rows = collector.list_notices(key, limit=30)
                self.assertEqual(rows[0]["title"], "테스트 공지")
                self.assertEqual(rows[0]["writer"], "정보통신팀")

    def test_calendar_board(self):
        response = {"list": [{
            "articleNo": 1, "articleTitle": "개강", "etcChar4": "2026",
            "etcChar5": "2", "etcChar6": "2026-09-01", "etcChar7": "2026-09-01",
            "boardNo": 85,
        }]}
        with patch("collector.post_json", return_value=response):
            rows = collector.list_notices("calendar", year=2026)
        self.assertEqual(rows[0]["category"], "학사일정")

    def test_restaurant_board_and_food_court(self):
        with patch("collector.fetch", return_value=MEAL_HTML):
            rows = collector.list_notices("restaurant", date="2026-08-23")
        self.assertEqual(len(rows), 8)
        self.assertEqual({row["corner"] for row in rows}, {"한식(식판)", "푸드코트"})
        food_court = next(row for row in rows if row["corner"] == "푸드코트")
        self.assertEqual(food_court["menu"], ["볶음밥", "샐러드"])

    def test_restaurant_ids_are_stable_within_the_same_week(self):
        with patch("collector.fetch", return_value=MEAL_HTML):
            first = collector.list_notices("restaurant", date="2026-08-23")
            second = collector.list_notices("restaurant", date="2026-08-25")
        self.assertEqual({row["id"] for row in first}, {row["id"] for row in second})

    def test_restaurant_can_collect_only_breakfast(self):
        with patch("collector.fetch", return_value=MEAL_HTML) as fetch_mock:
            rows = collector.list_notices(
                "restaurant", date="2026-06-01", meal_categories=["B"])
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["meal"] == "조식" for row in rows))
        self.assertEqual(fetch_mock.call_count, 1)

    def test_three_standard_webzines(self):
        for key in ("today", "newsletter"):
            with self.subTest(board=key), patch("collector.fetch", return_value=WEBZINE_HTML):
                rows = collector.list_notices(key, limit=30)
                self.assertEqual(rows[0]["title"], "웹진 제목")
                self.assertLessEqual(len(rows[0]["summary"]), collector.SUMMARY_CHARS)

        with patch("collector.fetch", return_value=FOCUS_HTML):
            rows = collector.list_notices("focus", limit=30)
        self.assertEqual(rows[0]["link_type"], "external")

    def test_people_webzine(self):
        with patch("collector.fetch", return_value=PEOPLE_HTML):
            rows = collector.list_notices("people", limit=30)
        self.assertEqual(rows[0]["title"], "상명피플 제목")
        self.assertEqual(rows[0]["date"], "2026-08-21")


if __name__ == "__main__":
    unittest.main()

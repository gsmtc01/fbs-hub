from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from validate_data import validate


class PublicDataPolicyTest(unittest.TestCase):
    def test_current_public_json(self):
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(validate(root / "data" / "notices.json"), [])

    def test_high_risk_identifiers_are_rejected(self):
        boards = (
            "univ", "coneng", "fbs", "recruit", "cs_recruit", "calendar", "restaurant",
            "today", "newsletter", "people", "focus",
        )
        payload = {
            "schemaVersion": 3,
            "sources": [{"key": key} for key in boards],
            "items": [{
                "id": f"{key}:1",
                "board": key,
                "title": "문의 010-1234-5678" if key == "univ" else "안내",
                "summary": "",
                "writer": "정보통신팀",
                "url": "https://example.com/item",
                **({"day": "월(08.24)", "meal": "중식", "corner": "한식(식판)", "menu": ["밥"]}
                   if key == "restaurant" else {}),
            } for key in boards],
        }
        with TemporaryDirectory() as directory:
            path = Path(directory) / "notices.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            self.assertTrue(any("휴대전화 번호" in error for error in validate(path)))


if __name__ == "__main__":
    unittest.main()

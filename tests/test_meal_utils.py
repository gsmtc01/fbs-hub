from __future__ import annotations

import unittest

from meal_utils import meal_identity, normalize_meal_corner, resolve_meal_date


class MealNormalizationTest(unittest.TestCase):
    def test_legacy_korean_corner_uses_source_label(self):
        self.assertEqual(normalize_meal_corner("한식"), "한식(식판)")

    def test_same_week_has_stable_identity_across_collection_dates(self):
        first = meal_identity("월(08.24)", "중식", "한식", "2026-08-23")
        second = meal_identity("월(08.24)", "중식", "한식(식판)", "2026-08-25")
        self.assertEqual(first, second)
        self.assertEqual(resolve_meal_date("월(08.24)", "2026-08-25"), "2026-08-24")

    def test_food_court_remains_a_separate_corner(self):
        korean = meal_identity("월(08.24)", "중식", "한식(식판)", "2026-08-25")
        food_court = meal_identity("월(08.24)", "중식", "푸드코트", "2026-08-25")
        self.assertNotEqual(korean, food_court)


if __name__ == "__main__":
    unittest.main()

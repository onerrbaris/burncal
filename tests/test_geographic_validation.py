"""Bölge hatası il yüzdelerinden değil, toplanan tahmin ve gözlemlerden gelir."""
import copy
import json
import unittest
from pathlib import Path

import numpy as np

from scripts.build_geographic_regions import build, load_validation
from scripts.validate_geographic_regions import scores

ROOT = Path(__file__).resolve().parents[1]


class GeographicValidationTest(unittest.TestCase):
    def test_annual_and_monthly_errors_are_distinct(self):
        s = scores(np.array([[110., 90.]]), np.array([[100., 100.]]))
        self.assertEqual(s['annual_wape'], 0)
        self.assertEqual(s['monthly_wape'], 0.1)
        self.assertEqual(s['bias'], 0)

    def test_provinces_are_summed_before_error(self):
        p = np.array([[[110.]], [[90.]]]); o = np.array([[[100.]], [[100.]]])
        self.assertEqual(scores(p.sum(axis=0), o.sum(axis=0))['annual_wape'], 0)
        self.assertGreater(scores(p[0], o[0])['annual_wape'], 0)

    def test_current_validation_is_attached_and_stale_validation_rejected(self):
        folder = ROOT / 'web/data'
        data = json.loads((folder / 'atlas.json').read_text(encoding='utf-8'))
        geo = json.loads((folder / 'tr-provinces.json').read_text(encoding='utf-8'))
        val = load_validation(data)
        self.assertIsNotNone(val)
        regions = build(data, geo, val)['regions']
        self.assertEqual(len(regions), 7)
        for region in regions.values():
            self.assertEqual(region['validation']['n_years'], 14)
            self.assertGreaterEqual(region['validation']['annual_wape'], 0)
            self.assertGreaterEqual(region['validation']['monthly_wape'], region['validation']['annual_wape'])
        stale = copy.deepcopy(data)
        stale['validation']['Antalya']['annual_wape'] += 0.01
        self.assertIsNone(load_validation(stale))


if __name__ == '__main__':
    unittest.main()

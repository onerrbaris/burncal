"""Bölge toplamları il verisini ve eksik gözlemleri korumalıdır."""
import copy
import json
import unittest
from pathlib import Path

from scripts.build_geographic_regions import GROUPS, build, total_rows

ROOT = Path(__file__).resolve().parents[1]


class GeographicRegionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / 'web/data/atlas.json').read_text(encoding='utf-8'))
        cls.geo = json.loads((ROOT / 'web/data/tr-provinces.json').read_text(encoding='utf-8'))
        cls.regions = build(cls.data, cls.geo)

    def test_every_province_once(self):
        members = [p for group in GROUPS.values() for p in group]
        self.assertEqual(len(members), 81)
        self.assertEqual(len(set(members)), 81)
        self.assertEqual(set(members), set(self.data['provinces']))

    def test_each_region_month_matches_its_provinces(self):
        for name, region in self.regions['regions'].items():
            for sensor, series in region['series'].items():
                for year, row in series.items():
                    for month, actual in enumerate(row):
                        values = [self.data['provinces'][p][sensor][year][month] for p in region['members']]
                        if any(v is None for v in values):
                            self.assertIsNone(actual)
                        else:
                            self.assertAlmostEqual(actual, sum(values), places=5, msg=f'{name}/{sensor}/{year}/{month}')

    def test_partial_comparisons_preserve_country_total(self):
        for key, regions in self.regions['partial'].items():
            for i in range(len(self.data['partial']['years'])):
                self.assertAlmostEqual(sum(row[i] for row in regions.values()),
                                       sum(row[i] for row in self.data['partial'][key].values()), places=5)

    def test_missing_observations_are_not_zero(self):
        self.assertEqual(total_rows([[4, None], [6, 5]]), [10, None])
        data = copy.deepcopy(self.data)
        data['provinces']['Antalya']['merged']['2021'][0] = None
        self.assertIsNone(build(data, self.geo)['regions']['Akdeniz']['series']['merged']['2021'][0])

    def test_no_invented_validation(self):
        self.assertTrue(all(r['validation'] is None for r in self.regions['regions'].values()))


if __name__ == '__main__':
    unittest.main()

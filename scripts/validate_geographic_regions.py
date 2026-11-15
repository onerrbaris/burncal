"""Yedi il grubunun uyumlaştırma hatasını 2012–2025 yıllarını tek tek dışarıda bırakarak ölçer.

Mevcut günlük önbelleği kullanır; indirme yapmaz ve il serilerini değiştirmez.
Çalıştırma: .venv/Scripts/python.exe scripts/validate_geographic_regions.py
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from .build_geographic_regions import GROUPS
except ImportError:
    from build_geographic_regions import GROUPS

ROOT = Path(__file__).resolve().parents[1]


def scores(pred, obs):
    """Yıl × ay tablosundan yıllık/aylık WAPE ve toplam yanlılık."""
    denominator = float(obs.sum())
    assert denominator > 0
    return {'annual_wape': float(np.abs(pred.sum(axis=1) - obs.sum(axis=1)).sum() / denominator),
            'monthly_wape': float(np.abs(pred - obs).sum() / denominator),
            'bias': float(pred.sum() / denominator - 1)}


def main():
    folder = ROOT / 'web/data'
    atlas = json.loads((folder / 'atlas.json').read_text(encoding='utf-8'))
    boundary = ROOT / 'data/raw/boundaries/TUR-ADM1.geojson'
    if not boundary.exists():
        boundary = ROOT / 'data/processed/boundaries/TUR-ADM1.geojson'
    aliases = {'Afyonkarahisar': 'Afyon', 'Hakkâri': 'Hakkari'}
    names = [aliases.get(f['properties']['shapeName'], f['properties']['shapeName'])
             for f in json.loads(boundary.read_text(encoding='utf-8'))['features']]
    assert set(names) == set(atlas['provinces']) and len(names) == 81
    year = int(atlas['meta']['data_through'][:4])
    cache = ROOT / f'data/processed/harmonized_daily_{year}.npz'
    with np.load(cache, allow_pickle=False) as z:
        counts, out, insp = z['cnt'], z['out'], z['insp']
    assert counts.shape[0] == len(names) and counts.shape[2] == 3
    dates = pd.Timestamp('2000-01-01') + pd.to_timedelta(np.arange(counts.shape[1]), unit='D')
    valid = np.all(insp & ~out, axis=0) & (dates.year >= 2012) & (dates.year <= 2025)
    months = (dates.year[valid] - 2012) * 12 + dates.month[valid] - 1
    modis = np.zeros((81, 168)); viirs = np.zeros_like(modis)
    for p in range(81):
        modis[p] = np.bincount(months, weights=counts[p, valid, 0] + counts[p, valid, 1], minlength=168)
        viirs[p] = np.bincount(months, weights=counts[p, valid, 2], minlength=168)
    modis = modis.reshape(81, 14, 12); viirs = viirs.reshape(81, 14, 12)
    codes = list(atlas['regions'])
    region_idx = np.array([codes.index(atlas['validation'][name]['region']) for name in names])
    predicted = np.zeros_like(modis)
    for held_out in range(14):
        train = np.arange(14) != held_out
        mr = np.zeros((len(codes), 12)); vr = np.zeros_like(mr)
        np.add.at(mr, region_idx, modis[:, train].sum(axis=1))
        np.add.at(vr, region_idx, viirs[:, train].sum(axis=1))
        national = vr.sum(axis=0) / mr.sum(axis=0)
        factors = np.where(mr >= 50, vr / np.maximum(mr, 1e-9), national[None, :])
        predicted[:, held_out] = modis[:, held_out] * factors[region_idx]

    # Aynı sıralama, maske ve yöntem kullanıldığını mevcut 81 ilin sonuçlarıyla doğrula.
    for p, name in enumerate(names):
        result = scores(predicted[p], viirs[p])
        for key in ('annual_wape', 'monthly_wape'):
            assert abs(result[key] - atlas['validation'][name][key]) <= 0.00051, (name, key, result[key])
    regions = {}
    for name, members in GROUPS.items():
        indices = [names.index(p) for p in members]
        result = scores(predicted[indices].sum(axis=0), viirs[indices].sum(axis=0))
        mean = sum(sum(atlas['provinces'][p]['merged'][str(y)]) for p in members for y in range(2012, 2026)) / 14
        w = result['annual_wape']
        result.update(confidence='low' if w > 0.30 or mean < 100 else 'high' if w <= 0.15 and mean >= 300 else 'medium',
                      mean_annual=round(mean), n_years=14, observed_detections=int(viirs[indices].sum()))
        regions[name] = result
        print(f'{name}: yıllık %{100*w:.1f}, aylık %{100*result["monthly_wape"]:.1f}, {result["confidence"]}')
    signature = hashlib.sha256(json.dumps(atlas['validation'], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    membership = hashlib.sha256(json.dumps(GROUPS, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    doc = {'meta': {'years': [2012, 2025], 'n_years': 14, 'method': 'leave-one-year-out',
                    'province_validation_sha256': signature, 'membership_sha256': membership,
                    'note': '2012–2025: her yıl eğitimden çıkarılır; il tahminleri ve VIIRS gözlemleri bölge içinde toplanır, WAPE toplamlar üzerinden hesaplanır. Yalnızca üç uydunun da çalıştığı günler kullanılır. Güven düzeyi yıllık hataya göre verilir; aylık hata ayrıca gösterilir.',
                    'limit': 'Uyumlaştırılmış tespit sayısının VIIRS ile uyumunu ölçer; yanan alan veya gerçek yangın sayısının hatası değildir. 2012 öncesi doğrudan doğrulama yoktur.'},
           'regions': regions}
    (folder / 'geographic-validation.json').write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding='utf-8')
    print('81 ilin mevcut hata sonuçlarıyla eşleşme doğrulandı.')


if __name__ == '__main__':
    main()

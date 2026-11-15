"""Atlasın il serilerinden yedi coğrafi bölge için il grubu toplamlarını üretir.

Coğrafi sınırlar il sınırlarıyla aynı değildir; bu ürün illeri bütün olarak gruplar.
Yeni katsayı hesaplamaz; ayrı doğrulama çıktısını imzası eşleşirse ekler. Yalnızca standart kütüphane kullanır.
"""
import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GROUPS = {
    "Marmara": "Balıkesir Bilecik Bursa Çanakkale Edirne İstanbul Kırklareli Kocaeli Sakarya Tekirdağ Yalova".split(),
    "Ege": "Afyon Aydın Denizli İzmir Kütahya Manisa Muğla Uşak".split(),
    "Akdeniz": "Adana Antalya Burdur Hatay Isparta Mersin Kahramanmaraş Osmaniye".split(),
    "İç Anadolu": "Aksaray Ankara Çankırı Eskişehir Karaman Kayseri Kırıkkale Kırşehir Konya Nevşehir Niğde Sivas Yozgat".split(),
    "Karadeniz": "Amasya Artvin Bartın Bayburt Bolu Çorum Düzce Giresun Gümüşhane Karabük Kastamonu Ordu Rize Samsun Sinop Tokat Trabzon Zonguldak".split(),
    "Doğu Anadolu": "Ağrı Ardahan Bingöl Bitlis Elazığ Erzincan Erzurum Hakkari Iğdır Kars Malatya Muş Tunceli Van".split(),
    "Güneydoğu Anadolu": "Adıyaman Batman Diyarbakır Gaziantep Kilis Mardin Siirt Şanlıurfa Şırnak".split(),
}
NOTE = "İller bütün olarak gruplanmıştır; gösterilen sınırlar coğrafi bölge sınırlarının il bazında yaklaşımıdır."
SOURCE = "https://caybasiyenikoyilkokulu.meb.k12.tr/meb_iys_dosyalar/54/15/732430/dosyalar/2020_10/27112902_Yartname.pdf"


def total_rows(rows):
    """Eksik gözlemi sıfır saymaz; bütün üyeler doluysa toplar."""
    return [None if any(v is None for v in col) else round(sum(col), 1) for col in zip(*rows)]


def load_validation(data):
    path = ROOT / 'web/data/geographic-validation.json'
    if not path.exists():
        return None
    doc = json.loads(path.read_text(encoding='utf-8'))
    signature = hashlib.sha256(json.dumps(data['validation'], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    membership = hashlib.sha256(json.dumps(GROUPS, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if doc['meta']['province_validation_sha256'] != signature or doc['meta']['membership_sha256'] != membership:
        print('Bölge doğrulaması eski: validate_geographic_regions.py yeniden çalıştırılmalı.')
        return None
    assert set(doc['regions']) == set(GROUPS)
    return doc


def build(data, geo, validation=None):
    names = [p for members in GROUPS.values() for p in members]
    assert len(names) == len(set(names)) == 81
    assert set(names) == set(data['provinces']) == {f['properties']['name'] for f in geo['features']}
    regions = {}
    for name, members in GROUPS.items():
        series = {}
        for sensor in ('merged', 'modis', 'viirs'):
            years = set.intersection(*(set(data['provinces'][p][sensor]) for p in members))
            series[sensor] = {y: total_rows([data['provinces'][p][sensor][y] for p in members]) for y in sorted(years)}
        regions[name] = {'members': members, 'series': series,
                         'validation': validation['regions'][name] if validation else None}
    partial = {}
    for key in ('mtd', 'ytd', 'mtd_modis', 'mtd_viirs'):
        by_province = data.get('partial', {}).get(key)
        if by_province:
            partial[key] = {name: total_rows([by_province[p] for p in members]) for name, members in GROUPS.items()}
    return {'meta': {'generated': 'scripts/build_geographic_regions.py', 'data_through': data['meta']['data_through'],
                     'note': NOTE, 'membership_source': SOURCE,
                     'validation_note': (validation['meta']['note'] + ' ' + validation['meta']['limit']) if validation else
                         'Bölge toplamı için doğrulama yapılmadı; il hata yüzdeleri birleştirilmedi.'},
            'regions': regions, 'partial': partial}


def main():
    folder = ROOT / 'web' / 'data'
    data = json.loads((folder / 'atlas.json').read_text(encoding='utf-8'))
    geo = json.loads((folder / 'tr-provinces.json').read_text(encoding='utf-8'))
    out = folder / 'geographic-regions.json'
    result = build(data, geo, load_validation(data))
    out.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(result["regions"])} bölge, 81 il: {out}')


if __name__ == '__main__':
    main()

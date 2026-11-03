import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/monthly'))
from retail_release_policy import retail_publication_eligibility, retail_release_eligibility

class RetailRestorationTests(unittest.TestCase):
    def test_bound_restoration_survives_without_becoming_release_proof(self):
        p = dict(id='old', brand='Nike', style='AB1234-001', url='https://shop.example/item',
                 image='https://shop.example/photo.jpg', source='retail-ssense', listedAt='2024-01-01')
        p['retailRestoration'] = {k: p[k] for k in ('id','brand','style','url','image')}
        p['retailRestoration']['snapshotId'] = 'retail-restored-20261103'
        self.assertTrue(retail_publication_eligibility(p, '2026-11-03')['eligible'])
        self.assertFalse(retail_release_eligibility(p, '2026-11-03')['eligible'])
        for field in ('id','brand','style','url','image'):
            self.assertFalse(retail_publication_eligibility(dict(p, **{field:'changed'}), '2026-11-03')['eligible'])

if __name__ == '__main__':
    unittest.main()

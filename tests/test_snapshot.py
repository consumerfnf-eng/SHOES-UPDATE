import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from patch_snapshot import preserve_products, patch
from validate_coverage import validate

class SnapshotTests(unittest.TestCase):
    def test_existing_hidden_records_and_canonical_duplicates(self):
        old = {'id':'old', 'brand':'Example', 'style':'ABC123', 'url':'https://shop.example/products/shoe', 'hidden':True}
        duplicate = dict(old, id='incoming', url='https://shop.example/collections/new/products/shoe?utm_source=test')
        different_style = dict(old, id='other', url='https://shop.example/products/alias')
        new = dict(old, id='new', style='DEF456', url='https://shop.example/products/new')
        self.assertEqual(preserve_products([old], [duplicate,different_style,new]), [old,new])

    def test_no_response_and_test_scope_rejected(self):
        state={'products':[{}], 'crawler':{'scope':'full'}, 'coverage':[{'brand':'A','attempts':3,'responses':0}]}
        with self.assertRaisesRegex(ValueError,'ALL_MANDATORY'): validate(state,['A'])
        state['coverage'][0]['responses']=1
        state['crawler']['scope']='test'
        with self.assertRaisesRegex(ValueError,'full daily'): validate(state,['A'])

    def test_snapshot_preserves_seed_and_rotates_already_published_cache_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for folder in ['public','data','config']: (root/folder).mkdir()
            old={'id':'old','brand':'A','url':'https://example.com/products/old'}
            html='const SEED_PRODUCTS='+json.dumps([old])+';const TREND_SNAPSHOT={"updated":"old","items":[]};'
            for key,suffix in [('LIVE','live-products'),('SEEN','seen'),('TREND','trend'),('META','meta')]:
                html+=f"const {key}_KEY='shoes-ss-{suffix}-pub-20260923';"
            html+="let META=safeParse(APP_STORAGE.getItem(META_KEY),{lastUpdateDay:'2026-09-23'});"
            (root/'public/index.html').write_text(html)
            (root/'config/mandatory_brands.json').write_text('{"brands":[{"canonical":"A"}]}')
            state={'products':[dict(old,id='new',url='https://example.com/products/new')], 'crawler':{'scope':'full'},'coverage':[{'brand':'A','attempts':1,'responses':1}], 'meta':{'lastFinished':'2026-09-24 KST','lastUpdateDay':'2026-09-24'}}
            (root/'data/runtime_state.json').write_text(json.dumps(state))
            result=patch(root)
            updated=(root/'public/index.html').read_text()
            self.assertEqual(result['product_count'],2)
            self.assertIn('"id":"old"',updated)
            self.assertNotIn("pub-20260923'",updated)
            self.assertIn('2026-09-24',updated)
            self.assertTrue((root/'public/data/last_update.json').exists())

if __name__ == '__main__': unittest.main()

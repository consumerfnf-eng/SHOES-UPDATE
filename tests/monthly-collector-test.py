import importlib.util,unittest
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'scripts/monthly-sneakers.py'
spec=importlib.util.spec_from_file_location('monthly',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW='2026-10-27T18:00:00+09:00'
class MonthlyTest(unittest.TestCase):
 def tile(self,key='P12345678',badge='NEW',name='Speedcat leather sneakers'):
  return f'<article><span>{badge}</span><p class="brand">PUMA</p><a href="/kr/en/women/puma-speedcat-{key.lower()}">{name}</a><img src="https://img.mytheresa.com/{key}.jpg" /></article>'
 def test_new_not_new_season(self):
  d=m.extract_listing(self.tile()+self.tile('P12345679','NEW SEASON'),'mytheresa',m.SOURCES['mytheresa']['url'],NOW)
  self.assertEqual(len(d['products']),1);self.assertEqual(d['products'][0]['style'],'P12345678');self.assertIsNone(d['products'][0]['releaseDate'])
 def test_no_neighbor_image(self):
  d=m.extract_listing(self.tile()+self.tile('P12345679'),'mytheresa',m.SOURCES['mytheresa']['url'],NOW)
  self.assertEqual(len(d['products']),2)
  for p in d['products']:self.assertIn(p['style'],p['image'])
 def test_excludes_non_sneaker(self):
  d=m.extract_listing(self.tile(name='leather loafers'),'mytheresa',m.SOURCES['mytheresa']['url'],NOW);self.assertEqual(d['products'],[])
 def test_block(self):
  for text in ['Access denied','Reference BOT: foo','<html>empty</html>']:
   with self.assertRaises(ValueError):m.extract_listing(text,'farfetch',m.SOURCES['farfetch']['url'],NOW)
 def test_retains_partial(self):
  p=m.extract_listing(self.tile(),'mytheresa',m.SOURCES['mytheresa']['url'],NOW)['products']
  self.assertEqual(m.combine_previous(p,[],{'source':'mytheresa','complete':False}),p)
 def test_calendar(self):
  self.assertEqual(m.day_shift('2026-05-31',-3),'2026-02-28');self.assertEqual(m.day_shift('2026-10-27',-3),'2026-07-27')
 def test_release_not_manufactured(self):
  p=m.extract_listing(self.tile(),'mytheresa',m.SOURCES['mytheresa']['url'],NOW)['products'];m.validate_snapshot({'products':p,'signals':{}})
  p[0]['releaseDate']='2026-10-27'
  with self.assertRaises(AssertionError):m.validate_snapshot({'products':p,'signals':{}})
 def test_feed_original_date(self):
  xml='<rss><channel><item><title>PUMA Speedcat</title><link>https://publisher.example/a</link><pubDate>Mon, 26 Oct 2026 00:00:00 GMT</pubDate></item><item><title>Old PUMA</title><link>https://publisher.example/b</link><pubDate>Mon, 26 Jan 2026 00:00:00 GMT</pubDate></item></channel></rss>'
  rows,_,_=m.parse_feed(xml,{'id':'pub','name':'Pub','type':'magazine','domain':'publisher.example'},'2026-07-27','2026-10-27');self.assertEqual(len(rows),1)
 def test_model_needs_brand(self):
  models=m.models_for([{'id':'p1','name':'Speedcat sneakers','brand':'PUMA'}]);self.assertTrue(m.match_models('PUMA Speedcat new',models));self.assertFalse(m.match_models('Speedcat',models))
 def test_merchant_identifiers(self):
  self.assertEqual(m.pid('https://www.farfetch.com/ie/shopping/men/foo-item-1234.aspx','farfetch'),'1234');self.assertFalse(m.canonical('javascript:alert(1)'))
if __name__=='__main__':unittest.main()

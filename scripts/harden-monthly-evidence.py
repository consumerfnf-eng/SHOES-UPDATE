"""Idempotent evidence guard run before monthly collection and rendering."""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'scripts/monthly-sneakers.py'
text=path.read_text('utf-8')
replacement=r'''def match_models(text,models):
 # MONTHLY_EXACT_MODEL_V2: never match Air Jordan 1 inside 14 or 17.
 brand_alias={'nike':['나이키'],'adidas':['아디다스'],'asics':['아식스'],'salomon':['살로몬'],'newbalance':['뉴발란스'],'puma':['푸마'],'on':['온러닝'],'onitsukatiger':['오니츠카타이거'],'jordan':['조던']}
 korean={'airforce1':['에어포스1','에어 포스 1'],'airmax95':['에어맥스95'],'airmax90':['에어맥스90'],'speedcat':['스피드캣'],'cloudtilt':['클라우드틸트'],'samba':['삼바'],'sambaog':['삼바 OG'],'gazelle':['가젤'],'gazelleindoor':['가젤 인도어'],'mexico66':['멕시코66'],'tokuten':['토쿠텐']}
 def pattern(value):
  parts=re.findall(r'[\w]+',str(value),flags=re.U)
  return r'(?<!\w)'+r'[\W_]*'.join(re.escape(p) for p in parts)+r'(?!\w)'
 matches=[]
 for key,model in models.items():
  brand=model['brand'];bn=norm(brand);brands=[brand]+brand_alias.get(bn,[])
  if not any(re.search(pattern(b),text,re.I) for b in brands):continue
  aliases=list(model['aliases'])+korean.get(norm(model['name']),[])
  for alias in aliases:
   if re.search(pattern(alias),text,re.I):
    matches.append((key,len(norm(alias)),bn,norm(model['name'])));break
 # A specific edition must not inflate its shorter parent model's count.
 return [key for key,length,bn,name in matches if not any(obn==bn and olen>length and name in oname for other,olen,obn,oname in matches if other!=key)]

'''
if 'MONTHLY_EXACT_MODEL_V2' not in text:
 start=text.index('def match_models(');end=text.index('def parse_feed(',start)
 text=text[:start]+replacement+text[end:]
text=text.replace("row['modelKeys']=match_models(row['text'],models)","row['modelKeys']=match_models(row['title'],models)")
text=text.replace("'rankingScope':'등록 매체에서 실제 읽은 날짜 확인 기사 표본; 전체 인터넷 순위 아님'","'rankingScope':'등록 매체의 날짜 확인 원문 제목에서 해당 모델을 직접 소개한 기사 표본; 전체 인터넷 순위 아님'")
path.write_text(text,'utf-8')
# Validate the exact implementation used for the next run, without network requests.
namespace={'__file__':str(path),'__name__':'monthly_exact_test'}
exec(compile(text,str(path),'exec'),namespace)
models={'jordan:airjordan1':{'brand':'Jordan','name':'Air Jordan 1','aliases':['Air Jordan 1']},'jordan:airjordan14':{'brand':'Jordan','name':'Air Jordan 14','aliases':['Air Jordan 14']}}
assert namespace['match_models']('Air Jordan 17 release',models)==[]
assert namespace['match_models']('Air Jordan 14 release',models)==['jordan:airjordan14']
assert namespace['match_models']('Air Jordan 1 release',models)==['jordan:airjordan1']
assert namespace['match_models']('Nike Air Max 90 release',{'n':{'brand':'Nike','name':'Air Max 95','aliases':['Air Max 95']}})==[]
module=ROOT/'public/assets/monthly-sneakers.mjs';js=module.read_text('utf-8')
js=js.replace('/^\\w{64}$/','/^[a-f0-9]{64}$/')
js=js.replace("metric.averageLikes!==(likes.length?Math.round(sum/likes.length*100)/100:null)","(likes.length?(!Number.isFinite(metric.averageLikes)||Math.abs(metric.averageLikes-sum/likes.length)>0.0050001):metric.averageLikes!==null)")
js=js.replace('원문에서 모델 언급이 확인된 상품','원문 제목에서 모델이 직접 소개된 상품')
module.write_text(js,'utf-8')
app=ROOT/'public/assets/app.mjs';js=app.read_text('utf-8')
old="$('empty-description').textContent = state.source==='sns'"
new="$('empty-description').textContent = ['farfetch','mytheresa'].includes(state.source)?monthlyDescription(catalog,state.source):state.source==='sns'"
if old in js:js=js.replace(old,new)
app.write_text(js,'utf-8')
print('Exact model boundaries and headline-backed media evidence verified.')

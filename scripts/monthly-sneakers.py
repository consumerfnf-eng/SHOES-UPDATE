#!/usr/bin/env python3
"""Monthly sneaker evidence. NEW is not a launch date; missing likes are not zero.
Blocked or partial collections preserve the previous dated records.
"""
from __future__ import annotations
import argparse, base64, calendar, hashlib, json, os, re, tempfile, time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, urljoin, urlencode, parse_qs, urlunparse
from email.utils import parsedate_to_datetime
import requests
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
KST=timezone(timedelta(hours=9))
UA='SHOES-UPDATE/2.0 (monthly public footwear research)'
SOURCES={
 'farfetch':{'url':'https://www.farfetch.com/ie/shopping/men/shoes-2/items.aspx?sort=2&page=1&category=137174','host':'farfetch.com','gender':'men','newOnly':False},
 'mytheresa':{'url':'https://www.mytheresa.com/kr/en/women/shoes/sneakers','host':'mytheresa.com','gender':'women','newOnly':True}}
HASHTAGS=['신발추천','고프코어슈즈','스니커즈추천','신상스니커즈','sneakerrelease']
SNEAKER=re.compile(r'sneaker|trainer|running shoe|스니커즈|운동화',re.I)
EXCLUDE=re.compile(r'\b(?:boots?|loafers?|espadrilles|sandals?|slippers?|slides?|heels?)\b|부츠|구두|로퍼|샌들|슬리퍼',re.I)
BLOCKED=re.compile(r'access denied|captcha|reference\s+BOT\s*:|verify you are human|robot check|unusual traffic|target url returned error',re.I)
MODEL_PATTERNS=[r'gel[- ]?kayano\s*\d+',r'gel[- ]?1130(?:\s+mule)?',r'gel[- ]?nyc',r'gel[- ]?quantum\s*\d*',r'gt[- ]?2160',r'xt[- ]?6(?:\s+(?:gtx|gore[- ]?tex))?',r'xt[- ]?4',r'xa\s*pro\s*3d',r'speedcross\s*\d+',r'cloudtilt(?:\s+moon|\s+remix)?',r'cloudmonster\s*\d*',r'cloudaway\s*\d*',r'cloud\s*6',r'mexico\s*66',r'tokuten',r'speedcat(?:\s+ballet)?',r'palermo',r'samba(?:\s+og)?',r'gazelle(?:\s+indoor)?',r'taekwondo',r'japan',r'handball\s+spezial',r'air\s+max\s+\d+',r'air\s+force\s+1',r'air\s+jordan\s+\d+(?:\s+low)?',r'p[- ]?6000',r'vomero\s*\d+',r'pegasus\s*\d+',r'\b(?:204l|1906r|2002r|9060|991v2|530|740|1000)\b',r'super[- ]?star',r'ball\s+star',r'stardan',r'america[’\x27]?s\s+cup',r'speedrock',r'collapse',r'triple\s+s',r'track',r'replica',r'ma[- ]?94',r'skeltop']
def digest(value):return hashlib.sha256(value.encode('utf-8')).hexdigest()
def norm(value):return re.sub(r'[^\w]+','',str(value).casefold(),flags=re.U)
def canonical(url):
 try:
  p=urlparse(url)
  if p.scheme!='https' or not p.hostname or p.username or p.password:return ''
  q={k:v for k,v in parse_qs(p.query).items() if not re.match(r'utm_|aff|ref|click|campaign',k,re.I)}
  return urlunparse((p.scheme,p.netloc,p.path.rstrip('/'),'',urlencode(q,doseq=True),''))
 except Exception:return ''
def day_shift(day,months):
 d=datetime.fromisoformat(day);m=d.year*12+d.month-1+months;y,m=divmod(m,12);m+=1
 return f'{y:04d}-{m:02d}-{min(d.day,calendar.monthrange(y,m)[1]):02d}'
def parse_date(value):
 try:
  d=datetime.fromisoformat(str(value).replace('Z','+00:00'));return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
 except (ValueError,TypeError):
  try:return parsedate_to_datetime(value)
  except Exception:return None
def load(path,default):
 try:return json.loads(Path(path).read_text('utf-8'))
 except FileNotFoundError:return default
def write(path,value):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+'.tmp')
 tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8');tmp.replace(path)
def pid(url,source):
 m=re.search(r'-item-(\d+)\.aspx$' if source=='farfetch' else r'-(p\d+)$',urlparse(url).path,re.I)
 return m.group(1).upper() if m else ''
def same_host(url,host):
 h=(urlparse(url).hostname or '').lower();return h==host or h.endswith('.'+host)
def image_url(img,base):
 if img is None:return ''
 for attr in ('data-src','src','data-original'):
  u=urljoin(base,img.get(attr,''))
  if canonical(u) and re.search(r'\.(?:jpg|jpeg|png|webp)(?:[?]|$)',u,re.I):return u
 options=[part.strip().split()[0] for part in (img.get('srcset','') or img.get('data-srcset','')).split(',') if part.strip()]
 return next((urljoin(base,u) for u in reversed(options) if canonical(urljoin(base,u))),'')
def walk(value):
 if isinstance(value,dict):
  yield value
  for v in value.values():yield from walk(v)
 elif isinstance(value,list):
  for v in value:yield from walk(v)
def json_products(soup,source,base):
 products={}
 for script in soup.select('script[type="application/ld+json"]'):
  try:data=json.loads(script.string or script.get_text())
  except (ValueError,TypeError):continue
  for node in walk(data):
   typ=node.get('@type','')
   if 'Product' not in ([typ] if isinstance(typ,str) else typ):continue
   key=pid(urljoin(base,node.get('url','')),source)
   if key:products[key]=node
 return products
def extract_listing(html,source,url,observed_at,known_brands=()):
 """Bind a name/photo to its own visible tile, never the whole page."""
 soup=BeautifulSoup(html,'html.parser');text=soup.get_text(' ',strip=True)
 if BLOCKED.search(text[:6000]):raise ValueError('access-blocked')
 structured=json_products(soup,source,url);cards={};rejected=[]
 all_links=[a for a in soup.select('a[href]') if pid(urljoin(url,a.get('href','')),source)]
 for a in all_links:
  u=canonical(urljoin(url,a['href']));key=pid(u,source)
  if not same_host(u,SOURCES[source]['host']):continue
  box=a
  for parent in list(a.parents)[:7]:
   if parent.name in ('body','html'):break
   ids={pid(urljoin(url,x.get('href','')),source) for x in parent.select('a[href]')};ids.discard('')
   if ids!={key}:break
   box=parent
  lines=[x.strip() for x in box.stripped_strings if x.strip()];node=structured.get(key,{})
  candidates=[x.get_text(' ',strip=True) for x in box.select('a[href]') if pid(urljoin(url,x.get('href','')),source)==key]
  candidates=[t for t in candidates if SNEAKER.search(t) and len(t)<220 and not re.search('available sizes|see all sizes',t,re.I)]
  name=next(iter(sorted(candidates,key=len)),'')
  if not name:name=next((x for x in lines if SNEAKER.search(x) and len(x)<220 and not re.search('available sizes|see all sizes',x,re.I)),'')
  if not name:name=str(node.get('name',''))
  if not SNEAKER.search(name) or EXCLUDE.search(name):continue
  bn=node.get('brand',{});brand=bn.get('name','') if isinstance(bn,dict) else str(bn or '')
  if not brand:
   element=box.select_one('[data-component*="Brand"], [data-testid*="brand"], [class*="brand"], [class*="designer"]')
   if element:brand=element.get_text(' ',strip=True)
  if not brand:brand=next((b for b in sorted(known_brands,key=len,reverse=True) if any(norm(x)==norm(b) for x in lines)),'')
  if not brand:
   nidx=next((i for i,x in enumerate(lines) if x==name),-1)
   if nidx>0 and len(lines[nidx-1])<60 and not re.search(r'new|exclusive|size|€|₩|\$',lines[nidx-1],re.I):brand=lines[nidx-1]
  if not brand or len(brand)>70:rejected.append({'id':key,'reason':'brand-unresolved'});continue
  if name.lower().startswith(brand.lower()+' '):name=name[len(brand)+1:]
  badges=[x.casefold() for x in lines if re.fullmatch(r'new(?:\s+arrival[s]?)?|new\s+season',x,re.I)]
  badge='NEW' if any(x in ('new','new arrival','new arrivals') for x in badges) else 'NEW SEASON' if 'new season' in badges else ''
  if source=='mytheresa' and badge!='NEW':continue
  imgs=[image_url(img,url) for img in box.select('img')];imgs=[x for x in imgs if x and not re.search(r'logo|placeholder|icon',x,re.I)]
  compact=lambda value:re.sub(r'[/_-]','',value).upper()
  image=next((x for x in imgs if key in compact(urlparse(x).path)),'') or next(iter(imgs),'')
  if not image:rejected.append({'id':key,'reason':'product-tile-photo-missing'});continue
  offers=node.get('offers') or {};offers=offers[0] if isinstance(offers,list) and offers else offers
  price=(str(offers.get('price',''))+' '+str(offers.get('priceCurrency',''))).strip() if isinstance(offers,dict) else ''
  if not price:price=next((x for x in lines if re.search(r'[€₩$£]|\bEUR\b|\bKRW\b',x)),'')
  evidence={'retailer':source,'kind':'retailer-listing-card','productId':key,'url':url,'productUrl':u,'imageUrl':image,'observedAt':observed_at,'badge':badge,'contentHash':digest(str(box)),'newOnly':source=='mytheresa'}
  item={'id':f'{source}-{key.lower()}','brand':brand,'name':name,'style':key,'styleType':'retailer-product-id','gender':SOURCES[source]['gender'],'category':'sneaker','productType':'sneaker','url':u,'image':image,'colorway':str(node.get('color','') or ''),'colorSwatches':[],'priceLabel':price,'fit':[],'fitReasons':[],'releaseDate':None,'firstPublishedAt':observed_at,'lastVerifiedAt':observed_at,'retailerEvidence':evidence,'sourceSignals':[],'keywords':[]}
  if node.get('mpn'):item['manufacturerStyle']=str(node['mpn'])
  if key not in cards or len(lines)>cards[key][0]:cards[key]=(len(lines),item)
 ids={pid(urljoin(url,a['href']),source) for a in all_links};ids.discard('')
 match=re.search(r'\b\d+\s+of\s+([\d,]+)\s*(?:Next|$)',text,re.I);page_total=int(match.group(1).replace(',','')) if match else None
 match=re.search(r'([\d,]+)\s+Products\b',text,re.I);item_total=int(match.group(1).replace(',','')) if match else None
 next_url=''
 for a in soup.select('a[href]'):
  label=' '.join([a.get_text(' ',strip=True),a.get('aria-label',''),str(a.get('rel',''))]);candidate=urljoin(url,a['href'])
  if re.search(r'\bnext\b|다음',label,re.I) and same_host(candidate,SOURCES[source]['host']) and not pid(candidate,source):next_url=candidate;break
 if not ids:raise ValueError('no-product-cards')
 return {'products':[p for _,p in cards.values()],'ids':sorted(ids),'next':next_url,'totalPages':page_total,'totalProducts':item_total,'rejected':rejected}
class Reader:
 def __init__(self):
  self.session=requests.Session();self.session.headers.update({'User-Agent':UA});self.last={};self.reader_enabled=True
 def request(self,url,headers=None,max_bytes=12_000_000):
  host=urlparse(url).hostname or '';time.sleep(max(0,1.2-(time.monotonic()-self.last.get(host,0))));self.last[host]=time.monotonic()
  r=self.session.get(url,headers=headers or {},timeout=(10,50))
  if r.status_code==429:raise ValueError('rate-limited')
  if not r.ok:raise ValueError('http-'+str(r.status_code))
  if len(r.content)>max_bytes:raise ValueError('response-too-large')
  return r
 def html(self,url):
  failures=[]
  try:
   r=self.request(url);body=r.text
   if BLOCKED.search(BeautifulSoup(body,'html.parser').get_text(' ',strip=True)[:6000]):raise ValueError('access-blocked')
   if len(body)<100:raise ValueError('empty-response')
   if any(same_host(url,s['host']) for s in SOURCES.values()) and not re.search(r'-item-\d+\.aspx|-p\d+["\x27?]',body,re.I):raise ValueError('unrendered-listing')
   return body,'direct'
  except Exception as e:failures.append(type(e).__name__+':'+str(e)[:60])
  if self.reader_enabled:
   try:
    headers={'Accept':'application/json','X-Respond-With':'html','X-No-Cache':'true'}
    key=os.environ.get('JINA_API_KEY','')
    if key:headers['Authorization']='Bearer '+key
    r=self.request('https://r.jina.ai/'+url,headers=headers)
    try:
     j=r.json();data=j.get('data',{});body=data.get('html') or data.get('content') or ''
     if int(j.get('code',200))!=200:raise ValueError('reader-error')
    except requests.exceptions.JSONDecodeError:body=r.text
    if not body or BLOCKED.search(BeautifulSoup(body,'html.parser').get_text(' ',strip=True)[:6000]):raise ValueError('reader-access-blocked')
    return body,'jina-reader-live'
   except Exception as e:
    if re.search('http-(401|402|403)|rate-limited',str(e)):self.reader_enabled=False
    failures.append(type(e).__name__+':'+str(e)[:60])
  raise ValueError('; '.join(failures))
def crawl_retailer(reader,source,now,brands,deadline):
 config=SOURCES[source];url=config['url'];seen_pages=set();seen_ids=set();products={};pages=[];errors=[];complete=False;total_pages=None;total_products=None
 while url and time.monotonic()<deadline:
  url=canonical(url)
  if url in seen_pages:errors.append('pagination-url-repeated');break
  seen_pages.add(url)
  try:
   html,method=reader.html(url)
   if len(pages)<2:
    p=ROOT/'logs'/'monthly-source-samples'/f'{source}-{len(pages)+1}.html';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(html,'utf-8')
   result=extract_listing(html,source,url,now,brands);fresh=set(result['ids'])-seen_ids
   if not fresh:errors.append('pagination-products-repeated');break
   seen_ids.update(result['ids']);products.update({x['id']:x for x in result['products']})
   total_pages=result['totalPages'] or total_pages;total_products=result['totalProducts'] or total_products
   pages.append({'url':url,'method':method,'observedProducts':len(result['ids']),'accepted':len(result['products']),'rejected':result['rejected'],'hash':digest(html)})
   if result['next']:url=result['next'];continue
   if total_pages and len(pages)<total_pages:
    p=urlparse(config['url']);q=parse_qs(p.query);q['page']=[str(len(pages)+1)];url=urlunparse(p._replace(query=urlencode(q,doseq=True)));continue
   complete=bool(total_pages and len(pages)>=total_pages or total_products is not None and len(seen_ids)>=total_products)
   if not complete:errors.append('pagination-end-not-proven')
   break
  except Exception as e:errors.append(type(e).__name__+':'+str(e)[:160]);break
 if time.monotonic()>=deadline:errors.append('run-budget-reached')
 if any(p['rejected'] for p in pages):complete=False;errors.append('unresolved-product-cards')
 return list(products.values()),{'source':source,'checkedAt':now,'status':'complete' if complete else 'partial' if pages else 'blocked','complete':complete,'pagesRead':len(pages),'totalPages':total_pages,'productsObserved':len(seen_ids),'totalProducts':total_products,'accepted':len(products),'newOnly':config['newOnly'],'errors':errors,'pages':pages}
def model_identity(p):
 matches=[]
 for pattern in MODEL_PATTERNS:
  m=re.search(pattern,p.get('name',''),re.I)
  if m:matches.append(m.group(0))
 if not matches:return None
 model=max(matches,key=len).strip();brand=p.get('brand','').strip()
 return {'key':norm(brand)+':'+norm(model),'brand':brand,'name':model,'aliases':[model]}
def models_for(products):
 result={}
 for p in products:
  m=model_identity(p)
  if m:
   if m['key'] not in result:result[m['key']]={**m,'productIds':[]}
   result[m['key']]['productIds'].append(p['id'])
 return result
def match_models(text,models):
 t=norm(text);out=[];aliases={'nike':['나이키'],'adidas':['아디다스'],'asics':['아식스'],'salomon':['살로몬'],'newbalance':['뉴발란스'],'puma':['푸마'],'on':['온러닝'],'onitsukatiger':['오니츠카타이거']}
 for key,m in models.items():
  bn=norm(m['brand']);brand_ok=bn in t if len(bn)>2 else bool(re.search(r'\bon\b|온러닝',text,re.I));brand_ok=brand_ok or any(norm(x) in t for x in aliases.get(bn,[]))
  if brand_ok and any(norm(x) in t for x in m['aliases']):out.append(key)
 return out
def parse_feed(xml,source,cutoff,end):
 if '<!ENTITY' in xml or not re.search(r'<(?:rss|feed)\b',xml):raise ValueError('invalid-public-feed')
 soup=BeautifulSoup(xml,'xml');records=[];dated=[]
 for item in soup.find_all(['item','entry']):
  title=item.find('title');title=title.get_text(' ',strip=True) if title else ''
  date=item.find('pubDate') or item.find('published');dt=parse_date(date.get_text(strip=True)) if date else None
  if not dt:continue
  day=dt.astimezone(KST).date().isoformat();dated.append(day)
  if not cutoff<=day<=end:continue
  link=item.find('link');url=(link.get('href') or link.get_text(strip=True)) if link else '';url=canonical(url)
  if not url or not same_host(url,source['domain']):continue
  body=item.find('encoded') or item.find('content') or item.find('description') or item.find('summary')
  body=BeautifulSoup(body.get_text() if body else '','html.parser').get_text(' ',strip=True)
  records.append({'url':url,'title':title,'publishedAt':day,'text':title+'\n'+body,'publisher':source['id'],'publisherName':source['name'],'type':source['type']})
 next_link=soup.find('link',attrs={'rel':'next'})
 return records,next_link.get('href','') if next_link else '',min(dated) if dated else None
def archive_rows(reader,source,models,cutoff,end,deadline):
 """Follow public archive links; original publication dates, not modified dates."""
 url=source['url'];seen=set();rows=[];count=0;oldest=None;error=''
 while url and url not in seen and time.monotonic()<deadline:
  seen.add(url)
  try:
   html,_=reader.html(url);soup=BeautifulSoup(html,'html.parser');count+=1;dates=[]
   for a in soup.select('a[href]'):
    target=canonical(urljoin(url,a['href']));title=a.get_text(' ',strip=True)
    if not target or not same_host(target,source['domain']) or target in seen or len(title)<10:continue
    keys=match_models(title,models);box=a.find_parent('article') or a.parent;stamp=box.find('time') if box else None
    date=parse_date(stamp.get('datetime') or stamp.get_text()) if stamp else None
    dated_url=re.search(r'/(20\d{2})/(\d{1,2})/(\d{1,2})/',target)
    if not date and dated_url:
     try:date=datetime(*map(int,dated_url.groups()),tzinfo=timezone.utc)
     except ValueError:pass
    if date:dates.append(date.astimezone(KST).date().isoformat())
    if not keys:continue
    if not date and time.monotonic()<deadline:
     try:
      detail,_=reader.html(target);doc=BeautifulSoup(detail,'html.parser');meta=doc.select_one('meta[property="article:published_time"],meta[name="datePublished"]')
      if meta:date=parse_date(meta.get('content'))
      for script in doc.select('script[type="application/ld+json"]'):
       try:nodes=walk(json.loads(script.get_text()))
       except ValueError:continue
       for node in nodes:
        if any(t in str(node.get('@type','')) for t in ['NewsArticle','BlogPosting','Article']) and node.get('datePublished'):date=date or parse_date(node['datePublished'])
     except Exception:pass
    if not date:continue
    day=date.astimezone(KST).date().isoformat()
    if cutoff<=day<=end:rows.append({'url':target,'title':title[:250],'publishedAt':day,'text':title,'modelKeys':keys,'publisher':source['id'],'publisherName':source['name'],'type':source['type']})
   if dates:oldest=min(dates)
   if dates and max(dates)<cutoff:break
   next_url=''
   for a in soup.select('a[href]'):
    label=' '.join([a.get_text(' ',strip=True),a.get('aria-label',''),str(a.get('rel',''))]);candidate=canonical(urljoin(url,a['href']))
    if candidate and same_host(candidate,source['domain']) and re.search(r'\bnext\b|older posts|다음',label,re.I):next_url=candidate;break
   url=next_url
  except Exception as e:error=type(e).__name__+':'+str(e)[:100];break
 return rows,{'pagesRead':count,'oldestPublishedAt':oldest,'error':error,'exhaustive':False}
def crawl_media(reader,models,now,cutoff,deadline):
 sources=load(ROOT/'config/signal-sources.json',{}).get('editorialSources',[]);articles={};reports=[]
 for source in sources:
  if time.monotonic()>deadline:reports.append({'source':source['id'],'status':'not-run-budget'});continue
  url=source.get('feedUrl');visited=set();count=0;complete=False;error='';oldest=None
  while url and url not in visited and time.monotonic()<deadline:
   visited.add(url)
   try:
    r=reader.request(url,max_bytes=source.get('maxBytes',8_000_000));rows,next_url,oldest_page=parse_feed(r.text,source,cutoff,now[:10]);count+=1
    for row in rows:
     key=norm(row['title']);row['modelKeys']=match_models(row['text'],models)
     if row['modelKeys'] and key not in articles:articles[key]=row
    oldest=min(oldest,oldest_page) if oldest and oldest_page else oldest_page or oldest
    if oldest and oldest<cutoff:complete=True;break
    if next_url and same_host(next_url,source['domain']):url=next_url
    else:break
   except Exception as e:error=type(e).__name__+':'+str(e)[:100];break
  extra,archive=archive_rows(reader,source,models,cutoff,now[:10],min(deadline,time.monotonic()+90))
  for row in extra:
   key=norm(row['title'])
   if key not in articles:articles[key]=row
  reports.append({'archive':archive,'source':source['id'],'url':source.get('feedUrl') or source['url'],'status':'blocked' if not count and not archive['pagesRead'] else 'complete' if complete else 'partial-feed','pagesRead':count,'oldestPublishedAt':oldest,'windowComplete':complete,'error':error})
 groups=defaultdict(list)
 for row in articles.values():
  for key in row['modelKeys']:groups[key].append(row)
 metrics={}
 for key,rows in groups.items():
  unique={r['url']:r for r in rows};rows=list(unique.values())
  metrics[key]={'basis':'observed-editorial-corpus','identityLevel':'model','modelKey':key,'articleCount':len(rows),'publisherCount':len({r['publisher'] for r in rows}),'periodStart':cutoff,'periodEnd':now[:10],'observedAt':now,'sources':[{k:r[k] for k in ('url','title','publishedAt','publisher','publisherName','type')} for r in rows]}
 for key in metrics:metrics[key]['rank']=1+sum(metrics[x]['articleCount']>metrics[key]['articleCount'] for x in metrics)
 return metrics,{'status':'observed-corpus' if articles else 'no-confirmed-matches','checkedAt':now,'periodStart':cutoff,'periodEnd':now[:10],'articlesMatched':len({r['url'] for r in articles.values()}),'sources':reports,'exhaustive':False,'rankingScope':'등록 매체에서 실제 읽은 날짜 확인 기사 표본; 전체 인터넷 순위 아님'}
def crawl_instagram(models,now,cutoff):
 try:import instaloader
 except ImportError:return {},{'status':'dependency-missing','checkedAt':now}
 loader=instaloader.Instaloader(download_pictures=False,download_videos=False,download_video_thumbnails=False,download_geotags=False,download_comments=False,save_metadata=False,quiet=True,max_connection_attempts=1,request_timeout=25)
 username=os.environ.get('INSTAGRAM_USERNAME','');session=os.environ.get('INSTAGRAM_SESSION_BASE64','');session_path=None;posts={}
 status={'checkedAt':now,'hashtags':HASHTAGS,'selection':'hashtag-top-post-sample','periodStart':cutoff,'periodEnd':now[:10],'exhaustive':False,'sources':[]}
 try:
  if username and session:
   fd,session_path=tempfile.mkstemp(prefix='ig-session-');os.fchmod(fd,0o600)
   with os.fdopen(fd,'wb') as f:f.write(base64.b64decode(session,validate=True))
   loader.load_session_from_file(username,session_path)
  for tag in HASHTAGS:
   seen=0
   try:
    for post in instaloader.Hashtag.from_name(loader.context,tag).get_top_posts():
     seen+=1
     if seen>60:break
     stamp=post.date_utc
     if not stamp.tzinfo:stamp=stamp.replace(tzinfo=timezone.utc)
     date=stamp.astimezone(KST).date().isoformat()
     if not cutoff<=date<=now[:10]:continue
     caption=post.caption or '';keys=match_models(caption,models)
     if not keys:continue
     hidden=post._node.get('like_and_view_counts_disabled',False)
     try:likes=None if hidden else post.likes
     except Exception:likes=None
     likes=likes if isinstance(likes,int) and likes>=0 else None
     posts[post.shortcode]={'url':'https://www.instagram.com/p/'+post.shortcode+'/','publishedAt':date,'likes':likes,'captionHash':digest(caption),'accountHash':digest(str(post.owner_id)),'modelKeys':keys}
    status['sources'].append({'hashtag':tag,'status':'read','postsObserved':min(seen,60),'capped':seen>60})
   except Exception as e:
    status['sources'].append({'hashtag':tag,'status':'unavailable','error':type(e).__name__});break
 finally:
  if session_path:Path(session_path).unlink(missing_ok=True)
  loader.close()
 groups=defaultdict(list)
 for p in posts.values():
  for key in p['modelKeys']:groups[key].append(p)
 metrics={}
 for key,rows in groups.items():
  likes=[p['likes'] for p in rows if p['likes'] is not None]
  metrics[key]={'basis':'hashtag-top-post-sample','identityLevel':'model','modelKey':key,'postCount':len(rows),'accountCount':len({p['accountHash'] for p in rows}),'likesKnownCount':len(likes),'likesSum':sum(likes),'averageLikes':round(sum(likes)/len(likes),2) if likes else None,'periodStart':cutoff,'periodEnd':now[:10],'observedAt':now,'sources':[{k:p[k] for k in ('url','publishedAt','likes','captionHash')} for p in rows]}
 for key in metrics:metrics[key]['rank']=1+sum(metrics[x]['postCount']>metrics[key]['postCount'] for x in metrics)
 status['status']='observed-sample' if posts else 'authentication-or-source-unavailable' if any(x['status']=='unavailable' for x in status['sources']) else 'no-confirmed-matches'
 status['sessionConfigured']=bool(username and session);status['postsMatched']=len(posts)
 return metrics,status
def combine_previous(previous,current,coverage):
 byid={p['id']:p for p in previous};src=coverage['source'];old={p['id']:p for p in previous}
 if coverage['complete']:byid={i:p for i,p in byid.items() if p.get('retailerEvidence',{}).get('retailer')!=src}
 for p in current:
  if p['id'] in old:p['firstPublishedAt']=old[p['id']].get('firstPublishedAt',p['firstPublishedAt'])
  byid[p['id']]=p
 return list(byid.values())
def validate_snapshot(snapshot):
 ids=set()
 for p in snapshot['products']:
  if p['id'] in ids:raise ValueError('duplicate-id')
  ids.add(p['id']);e=p['retailerEvidence'];s=e['retailer']
  assert s in SOURCES and pid(p['url'],s)==e['productId']
  assert p['url']==e['productUrl'] and p['image']==e['imageUrl'] and canonical(p['image'])
  assert p['brand'] and p['name'] and re.fullmatch('[a-f0-9]{64}',e['contentHash'])
  assert p['releaseDate'] is None,'Merchant newness must not fabricate a release date'
  assert s!='mytheresa' or e['badge']=='NEW'
 for metric in snapshot['signals'].get('instagram',{}).values():
  assert metric['postCount']==len({p['url'] for p in metric['sources']})
  likes=[p['likes'] for p in metric['sources'] if p['likes'] is not None]
  assert metric['likesKnownCount']==len(likes) and metric['likesSum']==sum(likes)
  assert metric['averageLikes']==(round(sum(likes)/len(likes),2) if likes else None)
 for metric in snapshot['signals'].get('media',{}).values():
  assert metric['articleCount']==len({p['url'] for p in metric['sources']})
  assert metric['publisherCount']==len({p['publisher'] for p in metric['sources']})
def run(args):
 now=datetime.now(KST).isoformat(timespec='seconds');today=now[:10];cutoff=day_shift(today,-3)
 old=load(ROOT/'public/data/monthly-sneakers.json',{'products':[],'signals':{}});core=load(ROOT/'public/data/catalog.json',{'products':[],'brands':[]})
 brands=[b['name'] for b in core.get('brands',[])]+['Golden Goose','Maison Margiela','Fendi','Saint Laurent','Dolce&Gabbana','DSQUARED2','AMIRI','Hoff','VEJA','Autry','Premiata','Isabel Marant','Rick Owens','Rick Owens DRKSHDW','Maison MIHARA YASUHIRO','Jacquemus','Zegna','Versace','Valentino Garavani','Alexander McQueen','Puraai']
 reader=Reader();products=old.get('products',[]);coverage=[]
 for source in SOURCES:
  found,report=crawl_retailer(reader,source,now,brands,time.monotonic()+args.retail_minutes*60);products=combine_previous(products,found,report);coverage.append(report)
 models=models_for(core['products']+products)
 media,media_status=crawl_media(reader,models,now,cutoff,time.monotonic()+args.media_minutes*60)
 try:instagram,ig_status=crawl_instagram(models,now,cutoff)
 except Exception as e:instagram,ig_status={}, {'status':'unavailable','checkedAt':now,'error':type(e).__name__}
 signals={'media':media,'instagram':instagram}
 for key,status in [('media',media_status),('instagram',ig_status)]:
  if not signals[key] and (key=='instagram' and status.get('status')!='no-confirmed-matches' or key=='media' and not any(s.get('pagesRead') or s.get('archive',{}).get('pagesRead') for s in status.get('sources',[]))):signals[key]=old.get('signals',{}).get(key,{})
 snapshot={'schemaVersion':1,'checkedAt':now,'periodStart':cutoff,'periodEnd':today,'products':products,'models':models,'signals':signals,'sourceStatus':{'retailers':coverage,'media':media_status,'instagram':ig_status},'schedule':{'frequency':'monthly','day':1,'time':'08:00','timezone':'Asia/Seoul'},'notes':['Farfetch is retailer assortment, not proof of a recent launch.','Mytheresa accepts exact NEW/New Arrival, not New Season alone.','SNS and media describe the observed corpus, never the whole market.','Unknown body colors and likes remain unknown.']}
 validate_snapshot(snapshot);write(ROOT/'public/data/monthly-sneakers.json',snapshot)
 new=len({p['id'] for p in products}-{p['id'] for p in old.get('products',[])})
 write(ROOT/'logs/monthly-summary.json',{'checkedAt':now,'retailers':coverage,'media':media_status,'instagram':ig_status,'retailerProductsStored':len(products),'newRecords':new})
 print(json.dumps({'newRecords':new,'stored':len(products),'retailers':[{k:r[k] for k in ('source','status','pagesRead','accepted','errors')} for r in coverage],'media':media_status['status'],'instagram':ig_status['status']},ensure_ascii=False))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--retail-minutes',type=float,default=45);parser.add_argument('--media-minutes',type=float,default=15);run(parser.parse_args())

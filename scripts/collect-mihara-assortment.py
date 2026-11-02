from html.parser import HTMLParser
from urllib.parse import urljoin,parse_qs,urlsplit
from pathlib import Path
import json,re,hashlib,urllib.request,time
class Node:
 def __init__(self,tag,attrs,parent=None):self.tag=tag;self.a=dict(attrs);self.parent=parent;self.children=[];self.parts=[]
 def nodes(self,tag=None):
  for c in self.children:
   if tag is None or c.tag==tag:yield c
   yield from c.nodes(tag)
 def text(self):return ' '.join(self.parts+ [c.text() for c in self.children]).strip()
class DOM(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.root=Node('root',[]);self.stack=[self.root]
 def handle_starttag(self,t,a):
  n=Node(t,a,self.stack[-1]);self.stack[-1].children.append(n)
  if t not in ['img','br','hr','meta','link','input','source','area','base','embed','wbr']:self.stack.append(n)
 def handle_endtag(self,t):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==t:self.stack=self.stack[:i];break
 def handle_data(self,d):self.stack[-1].parts.append(d)

ROOT=Path(__file__).resolve().parents[1]
def main():
 import os
 os.chdir(ROOT)
 products={};pages=[]

 for sex,gender in [(1,'Men'),(2,'Women')]:
  queue=[f'https://en.miharayasuhiro.jp/products/list.php?category_id=27&sex_id={sex}'];seen=set();card_ids=set();advertised=None;raw_cards=0
  while queue:
   url=queue.pop(0)
   page=int(parse_qs(urlsplit(url).query).get('pageno',['1'])[0])
   if page in seen:continue
   seen.add(page);html=urllib.request.urlopen(url,timeout=25).read().decode('utf8');tree=DOM();tree.feed(html);root=tree.root
   total=re.search(r'(\d+)\s*items',html,re.I)
   if total:advertised=int(total.group(1))
   main=next((u for u in root.nodes('ul') if u.a.get('class')=='item_list_default'),None)
   if not main:raise RuntimeError('MIHARA_MAIN_PRODUCT_LIST_ABSENT')
   cards=[n for n in main.nodes('li') if 'product_item' in n.a.get('class','').split()];raw_cards+=len(cards);new=0
   Path(f'logs/mihara-list-{sex}-{page}.txt').write_text(html,encoding='utf8')
   for card in cards:
    name=next((n.text() for n in card.nodes('p') if n.a.get('class')=='list_name'),'')
    # Preserve every official category card; decide its actual footwear type separately.
    for a in card.nodes('a'):
     href=a.a.get('href','');q=parse_qs(urlsplit(href).query,keep_blank_values=True)
     if '/products/detail.php' not in href or not q.get('product_id'):continue
     image=next((i.a.get('data-src') or i.a.get('src') for i in a.nodes('img') if (i.a.get('data-src') or i.a.get('src','')).startswith('https://img.miharayasuhiro.jp/')),None)
     if not image:continue
     factory=re.search(r'/product/([^/]+)/',image)
     if not factory:raise RuntimeError('MIHARA_FACTORY_CODE_UNBOUND')
     pid=q['product_id'][0];colour=q.get('c',[''])[0];key=pid+':'+colour
     if pid not in card_ids:new+=1
     card_ids.add(pid);products[key]={'brand':'Maison Mihara Yasuhiro','name':name,'productId':pid,'colourId':colour,'manufacturerStyle':factory.group(1),'url':urljoin(url,href),'image':image,'source':url,'gender':gender,'contentHash':hashlib.sha256(html.encode()).hexdigest()}
   pages.append({'url':url,'advertised':advertised,'cards':len(cards),'newProducts':new,'uniqueProductIds':len(card_ids),'rawCardsSeen':raw_cards,'pageNumber':page,'contentHash':hashlib.sha256(html.encode()).hexdigest()})
   for a in root.nodes('a'):
    href=urljoin(url,a.a.get('href',''));u=urlsplit(href);q=parse_qs(u.query)
    if u.netloc=='en.miharayasuhiro.jp' and u.path=='/products/list.php' and q.get('category_id')==['27'] and q.get('sex_id')==[str(sex)] and q.get('pageno') and href not in seen and href not in queue:queue.append(href)
   Path('logs/mihara-raw-assortment.json').write_text(json.dumps({'products':list(products.values()),'pages':pages},ensure_ascii=False,indent=2),encoding='utf8')
   print(gender,len(card_ids),'of',advertised,'variants',len(products),flush=True);time.sleep(1)
  if advertised is None or raw_cards!=advertised:raise RuntimeError(f'MIHARA_TOTAL_MISMATCH: {gender} raw {raw_cards}/{advertised}, unique {len(card_ids)}')
 print('VERIFIED MIHARA',len(products),'colour-variant cards from',len(pages),'pages')

if __name__=="__main__":main()

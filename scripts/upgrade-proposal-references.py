"""Request larger renditions of the same observed official image assets."""
import concurrent.futures,hashlib,io,json,re,urllib.parse,urllib.request
from pathlib import Path
from PIL import Image,ImageOps,ImageChops
ROOT=Path(__file__).resolve().parents[1]
references=json.loads((ROOT/'logs/20261103/proposal-work/reference-images.json').read_bytes())
products={p['id']:p for p in json.loads((ROOT/'public/data/catalog.json').read_bytes())['products']}
mapping_path=ROOT/'data/proposal-reference-upgrades.json'
mapping=json.loads(mapping_path.read_bytes()) if mapping_path.exists() else {}
folder=ROOT/'public/proposals/originals';folder.mkdir(parents=True,exist_ok=True)
def crop(im):
    im=im.convert('RGBA');bg=Image.new('RGBA',im.size,'white');bg.alpha_composite(im);im=bg.convert('RGB')
    color=im.getpixel((0,0));box=ImageChops.difference(im,Image.new('RGB',im.size,color)).convert('L').point(lambda p:255 if p>35 else 0).getbbox()
    return im.crop(box) if box else im
def fingerprint(im):
    values=list(crop(im).convert('L').resize((16,16),Image.Resampling.LANCZOS).getdata());mean=sum(values)/len(values);return [v>mean for v in values]
def work(pair):
    key,reference=pair;id=key.split(':',1)[1];product=products[id]
    if id in mapping and (ROOT/'public'/mapping[id]['path'].lstrip('/')).exists():return id,mapping[id]
    url=product.get('presentation',{}).get('image') or product['image'];target=url
    target=re.sub(r'Resize=\(\d+\)','Resize=(2000)',target)
    target=re.sub(r'([?&](?:sw|wid|hei)=)\d+',lambda m:m[1]+'1800',target)
    target=re.sub(r'/w_\d+/', '/w_1600/',target)
    if '/_jcr_content/renditions/' in target:target=target.split('/_jcr_content/')[0]
    # Loro Piana's observed catalogue filenames explicitly identify SMALL renditions.
    if 'loropiana.com' in target:target=target.replace('_SMALL.jpg','_LARGE.jpg')
    if target==url:return id,None
    try:
        safe=urllib.parse.quote(target,safe=':/?&=%(),+@;')
        req=urllib.request.Request(safe,headers={'User-Agent':'Mozilla/5.0','Accept':'image/webp,image/*,*/*;q=.8'})
        with urllib.request.urlopen(req,timeout=20) as response:raw=response.read(20*1024*1024)
        with Image.open(io.BytesIO(raw)) as image:
            image=ImageOps.exif_transpose(image);width,height=image.size
            if width<=reference['originalWidth']*1.2:return id,None
            with Image.open(ROOT/'public'/reference['original'].lstrip('/')) as original:
                a=fingerprint(original);b=fingerprint(image);distance=sum(x!=y for x,y in zip(a,b))
            if distance>55:raise ValueError('same-asset visual check failed')
            rgba=image.convert('RGBA');canvas=Image.new('RGBA',rgba.size,'white');canvas.alpha_composite(rgba);encoded=io.BytesIO();canvas.convert('RGB').save(encoded,'JPEG',quality=96,optimize=True);data=encoded.getvalue()
        path='/proposals/originals/'+hashlib.sha256(data).hexdigest()[:24]+'.jpg';(ROOT/'public'/path.lstrip('/')).write_bytes(data)
        result={'path':path,'sourceUrl':target,'width':width,'height':height,'visualHashDistance':distance};print(product['brand'],id,width,height,flush=True);return id,result
    except Exception as error:
        print('Original retained:',product['brand'],id,type(error).__name__,flush=True);return id,None
candidates=[(key,value) for key,value in references.items() if key.startswith('product:') and value['width']<700]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for id,result in pool.map(work,candidates):
        if result:mapping[id]=result
mapping_path.write_text(json.dumps(mapping),encoding='utf-8')
print('Larger same-asset originals:',len(mapping),'/',len(candidates),flush=True)

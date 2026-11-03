"""Create legible local reference crops from the reviewed original source files."""
import hashlib
import json
from pathlib import Path
from PIL import Image,ImageOps,ImageChops,ImageFilter
ROOT=Path(__file__).resolve().parents[1]
config=json.loads((ROOT/'data/season-proposals.json').read_bytes())
products={p['id']:p for p in json.loads((ROOT/'public/data/catalog.json').read_bytes())['products']}
looks={p['id']:p for p in json.loads((ROOT/'public/data/catwalk.json').read_bytes())['looks']}
upgrades_file=ROOT/'data/proposal-reference-upgrades.json'
upgrades=json.loads(upgrades_file.read_bytes()) if upgrades_file.exists() else {}
folder=ROOT/'public/proposals/references';folder.mkdir(parents=True,exist_ok=True)
output={}
for idea in config['ideas']:
    for ref in idea['references']:
        key=ref['kind']+':'+ref['id']
        if key in output:continue
        row=(products if ref['kind']=='product' else looks)[ref['id']]
        original=row.get('presentation',{}).get('cachedPath') if ref['kind']=='product' else row['image']
        upgrade=upgrades.get(ref['id']) if ref['kind']=='product' else None
        if upgrade:original=upgrade['path']
        with Image.open(ROOT/'public'/original.lstrip('/')) as opened:
            im=ImageOps.exif_transpose(opened).convert('RGBA')
            original_size=im.size
            bg=Image.new('RGBA',im.size,'white');bg.alpha_composite(im);im=bg.convert('RGB')
        frame=row.get('presentation',{}).get('frame')
        if frame:
            w,h=im.size;pad=.025
            im=im.crop((max(0,int((frame['x']-pad)*w)),max(0,int((frame['y']-pad)*h)),min(w,int((frame['x']+frame['width']+pad)*w)),min(h,int((frame['y']+frame['height']+pad)*h))))
        elif ref['kind']=='product':
            if row['brand']=='Cecilie Bahnsen' and 'BLAISE' in row['name'].upper():
                im=im.crop((0,int(im.height*.52),im.width,im.height))
            else:
                # Uniform studio backgrounds only. Skip textured/on-foot photos.
                corners=[im.getpixel((x,y)) for x,y in [(0,0),(im.width-1,0),(0,im.height-1),(im.width-1,im.height-1)]]
                if max(max(c[i] for c in corners)-min(c[i] for c in corners) for i in range(3))<18:
                    color=tuple(sum(c[i] for c in corners)//4 for i in range(3))
                    mask=ImageChops.difference(im,Image.new('RGB',im.size,color)).convert('L').point(lambda p:255 if p>32 else 0).filter(ImageFilter.MedianFilter(5))
                    box=mask.getbbox()
                    if box and (box[2]-box[0])>im.width*.18:
                        px=int(im.width*.025);py=int(im.height*.025);im=im.crop((max(0,box[0]-px),max(0,box[1]-py),min(im.width,box[2]+px),min(im.height,box[3]+py)))
        elif im.height>im.width*1.15:
            im=im.crop((0,int(im.height*.24),im.width,im.height))
        im.thumbnail((1800,1800),Image.Resampling.LANCZOS)
        import io
        buf=io.BytesIO();im.save(buf,'JPEG',quality=94,optimize=True);encoded=buf.getvalue()
        name=hashlib.sha256(encoded).hexdigest()[:24]+'.jpg';(folder/name).write_bytes(encoded)
        output[key]={'image':'/proposals/references/'+name,'width':im.width,'height':im.height,'original':original,'originalWidth':original_size[0],'originalHeight':original_size[1],**({'largerSourceUrl':upgrade['sourceUrl']} if upgrade else {})}
(ROOT/'logs/20261103/proposal-work/reference-images.json').write_text(json.dumps(output),encoding='utf-8')
print(f'Prepared {len(output)} original reference crops without generating or relabelling any shoe imagery')

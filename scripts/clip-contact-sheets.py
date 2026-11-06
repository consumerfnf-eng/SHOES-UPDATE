"""Inspection sheets only. Source photographs remain unchanged."""
import json,sys
from pathlib import Path
from PIL import Image,ImageOps,ImageDraw
rows=json.loads(Path(sys.argv[1] if len(sys.argv)>1 else '.secrets/clip/site-blind-sample.json').read_text(encoding='utf-8'))['images']
prefix=sys.argv[2] if len(sys.argv)>2 else 'sheet'
directory=Path('.secrets/clip/contact');directory.mkdir(parents=True,exist_ok=True)
for start in range(0,len(rows),20):
    sheet=Image.new('RGB',(1500,1000),'white');draw=ImageDraw.Draw(sheet)
    for i,row in enumerate(rows[start:start+20]):
        with Image.open(row['path']) as photo:
            thumb=ImageOps.contain(ImageOps.exif_transpose(photo).convert('RGB'),(290,214))
            x=(i%5)*300;y=(i//5)*250;sheet.paste(thumb,(x+(300-thumb.width)//2,y+(218-thumb.height)//2))
            draw.text((x+12,y+225),row['sampleId'],fill='#102030')
    sheet.save(directory/f'{prefix}-{start//20+1:02}.jpg',quality=94)
print(json.dumps({'sheets':(len(rows)+19)//20,'rows':len(rows),'labelsShown':False}))

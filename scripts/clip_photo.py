"""Deterministic analysis input; never changes the archived photograph."""
from PIL import Image,ImageOps,ImageChops,ImageStat

def shoe_letterbox(image):
    rgba=ImageOps.exif_transpose(image).convert('RGBA')
    canvas=Image.new('RGBA',rgba.size,'white');canvas.alpha_composite(rgba);rgb=canvas.convert('RGB')
    if max(ImageStat.Stat(rgb).stddev)<2:raise ValueError('Blank image is not a classification input')
    small=rgb.copy();small.thumbnail((256,256))
    corners=[small.getpixel((x,y)) for x,y in [(0,0),(small.width-1,0),(0,small.height-1),(small.width-1,small.height-1)]]
    bg=tuple(sorted(c[i] for c in corners)[len(corners)//2] for i in range(3))
    difference=ImageChops.difference(small,Image.new('RGB',small.size,bg))
    channels=difference.split();mask=ImageChops.lighter(ImageChops.lighter(channels[0],channels[1]),channels[2]).point(lambda value:255 if value>28 else 0)
    bounds=mask.getbbox()
    if bounds:
        x0,y0,x1,y1=bounds;fraction=(x1-x0)*(y1-y0)/(small.width*small.height)
        if .025<fraction<.95:
            px=max(3,round(small.width*.035));py=max(3,round(small.height*.035))
            box=(max(0,(x0-px)*rgb.width//small.width),max(0,(y0-py)*rgb.height//small.height),min(rgb.width,(x1+px)*rgb.width//small.width),min(rgb.height,(y1+py)*rgb.height//small.height))
            rgb=rgb.crop(box)
    edge=round(max(rgb.size)*1.08);square=Image.new('RGB',(edge,edge),bg);square.paste(rgb,((edge-rgb.width)//2,(edge-rgb.height)//2))
    return square

from pathlib import Path
import json, re

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'internal'/'dashboard.html'
DST=ROOT/'public'/'index.html'
text=SRC.read_text(encoding='utf-8')

# 1) Remove the visible WGSN launch button.
btn_start=text.find('<button class="wgsn-launch" id="wgsnOpen"')
if btn_start >= 0:
    btn_end=text.find('</button>',btn_start)
    if btn_end < 0: raise RuntimeError('wgsnOpen closing button not found')
    text=text[:btn_start]+text[btn_end+len('</button>'):]

# 2) Remove the entire internal WGSN modal/lightbox DOM, including embedded images.
modal_start=text.find('<div aria-hidden="true" aria-labelledby="wgsnTitle"')
if modal_start < 0:
    modal_start=text.find('<div class="wgsn-modal" id="wgsnModal"')
if modal_start >= 0:
    footer_start=text.find('<footer',modal_start)
    if footer_start < 0: raise RuntimeError('footer after WGSN modal not found')
    text=text[:modal_start]+text[footer_start:]

# 3) Neutralize internal WGSN mappings/reasons that live inside shared JS.
def replace_js_value(src, marker, new_value):
    start=src.index(marker)+len(marker)
    opening=src[start]
    pairs={'[':']','{':'}'}
    if opening not in pairs:
        raise ValueError(f'Unsupported JS value after {marker}: {opening!r}')
    close=pairs[opening]; depth=0; ins=False; esc=False
    for i in range(start,len(src)):
        ch=src[i]
        if ins:
            if esc: esc=False
            elif ch=='\\': esc=True
            elif ch=='"': ins=False
            continue
        if ch=='"': ins=True
        elif ch==opening: depth+=1
        elif ch==close:
            depth-=1
            if depth==0:
                return src[:start]+json.dumps(new_value,ensure_ascii=False,separators=(',',':'))+src[i+1:]
    raise ValueError(f'Unclosed value for {marker}')

# Strip WGSN-derived per-product tags from the public snapshot as well.
if 'const SEED_PRODUCTS=' in text:
    start=text.index('const SEED_PRODUCTS=')+len('const SEED_PRODUCTS=')
    opening=text[start]
    if opening=='[':
        depth=0; ins=False; esc=False; end=None
        for i in range(start,len(text)):
            ch=text[i]
            if ins:
                if esc: esc=False
                elif ch=='\\': esc=True
                elif ch=='"': ins=False
                continue
            if ch=='"': ins=True
            elif ch=='[': depth+=1
            elif ch==']':
                depth-=1
                if depth==0:
                    end=i+1; break
        if end:
            products=json.loads(text[start:end])
            for product in products:
                product.pop('wgsnTrends',None)
            text=text[:start]+json.dumps(products,ensure_ascii=False,separators=(',',':'))+text[end:]

for marker in ('const WGSN_TREND_PRODUCTS=','const WGSN_META=','const WGSN_MATCH_REASONS='):
    if marker in text:
        text=replace_js_value(text,marker,{})
text=re.sub(r'const WGSN_STRICT_MATCH_MODE="[^"]*";', 'const WGSN_STRICT_MATCH_MODE="disabled-public";', text, count=1)

# 4) Make shared helpers tolerant of deliberately absent WGSN DOM.
text=text.replace("function openWgsn(){const m=$('#wgsnModal');m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.classList.add('body-lock');showWgsnProducts(state.wgsnTrend||'#QuietPrecision',false)}",
                  "function openWgsn(){const m=$('#wgsnModal');if(!m)return;m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.classList.add('body-lock');showWgsnProducts(state.wgsnTrend||'#QuietPrecision',false)}")
text=text.replace("function closeWgsn(){const m=$('#wgsnModal');m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.classList.remove('body-lock')}",
                  "function closeWgsn(){const m=$('#wgsnModal');if(!m)return;m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.classList.remove('body-lock')}")

# 5) Public metadata/layout; remove visible internal-only copy.
text=re.sub(r'<title>Clean Latest Shoes \+ WGSN 27/28 SS — (\d+) Brands</title>',r'<title>Clean Latest Shoes — \1 Brands</title>',text,count=1)
text=text.replace(' WGSN 메뉴는 사용자가 업로드한 S/S 27–28 자료를 요약한 내부 리서치 뷰이며, LATEST FOOTWEAR 탭은 2026-09-07 기준 지정 매체의 공개 기사·릴리스 신호를 요약합니다.','')
public_head='''\n<meta name="dashboard-build" content="public-no-wgsn">\n<style id="public-build-style">.header-topline{grid-template-columns:1fr!important}#wgsnOpen,#wgsnModal,#wgsnLightbox{display:none!important}</style>\n'''
text=text.replace('</head>',public_head+'</head>',1)

DST.parent.mkdir(parents=True,exist_ok=True)
DST.write_text(text,encoding='utf-8')
print(f'Built public site: {DST} ({DST.stat().st_size:,} bytes)')
print('script tag:', '<script>' in text)
print('WGSN launch present:', 'id="wgsnOpen"' in text)
print('WGSN modal present:', 'id="wgsnModal"' in text)
print('Public build marker:', 'public-no-wgsn' in text)

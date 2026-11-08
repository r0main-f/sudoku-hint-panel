#!/usr/bin/env python3
"""Regenerate every store image from the current extension/ code:
  store/screenshot-1-overview.png … screenshot-5-expert.png (1280×800)
  store/marquee-promo-1400x560.png
Needs Python 3 with Playwright and its Chromium (pip install playwright; playwright install chromium).
  python3 store/tools/screenshots.py            all images
  python3 store/tools/screenshots.py 2 4        only screenshots 2 and 4 (and the marquee, which uses 2)
Screenshots 1, 2, 3 and 5 show the sudoku.com panel on a stand-in page (stage.html) with the
content scripts injected; screenshot 4 is the extension's own "any grid" page, with a 16×16."""
import json, os, sys, tempfile, shutil
from playwright.sync_api import sync_playwright
from PIL import Image

TOOLS = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.dirname(TOOLS)
EXT = os.path.join(os.path.dirname(STORE), 'extension')
CSS = open(os.path.join(EXT, 'content.css')).read()
JS = '\n'.join(open(os.path.join(EXT, f)).read() for f in ['engine.js', 'explain.js', 'content.js'])
only = set(sys.argv[1:])
want = lambda n: not only or str(n) in only

def state(grid, givens=None, notes=None):
    givens = givens or [bool(v) for v in grid]
    return json.dumps({"values": [{"val": v, "editable": not givens[i], "conflict": False, "mistake": False} for i, v in enumerate(grid)],
                       "notes": notes or [None] * 81, "mode": "classic", "id": 1})
A = [int(c) for c in '000041090004000006080000070000500000007300800002060305649802000721906000358000000']
CELL = 560 / 9
def cell_xy(i): return (178 + (i % 9 + .5) * CELL, 190 + (i // 9 + .5) * CELL)

def panel_shot(p, name, st, title, sub, setup, adv=False, expert=False, out=None):
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + os.path.join(TOOLS, 'stage.html'))
    pg.evaluate("([s,t,u,o])=>{localStorage.clear();localStorage.setItem('main_game',s);localStorage.setItem('sdkh_fairplay_ok','1');localStorage.setItem('sdkh_opts',o);document.querySelector('#cap h1').textContent=t;document.querySelector('#cap p').textContent=u;draw()}",
                [st, title, sub, json.dumps({'advanced': adv, 'expert': expert})])
    pg.add_style_tag(content=CSS); pg.add_script_tag(content=JS); pg.wait_for_timeout(500)
    pg.evaluate("()=>{const p=document.querySelector('.sdkh-panel');p.style.left='802px';p.style.top='40px';p.style.right='auto';p.style.width='300px'}")
    setup(pg); pg.wait_for_timeout(400)
    pg.screenshot(path=out or os.path.join(STORE, name + '.png')); print(name, errs or 'ok')
    b.close()

def s1(pg):
    pg.click('.sdkh-cat[data-cat=single] .sdkh-cat-head'); pg.click('.sdkh-cat[data-cat=pointing] .sdkh-cat-head'); pg.mouse.move(1270, 790)
def s2(pg):
    pg.click('[data-act=assist]'); pg.wait_for_timeout(200)
    for _ in range(20):   # a hidden single shows the richest "why"
        pg.click('[data-as=more]'); pg.wait_for_timeout(100)
        if 'only place' in pg.evaluate("document.querySelector('.sdkh-chip').textContent"): break
        pg.click('[data-as=skip]'); pg.wait_for_timeout(100)
    pg.click('[data-as=more]'); pg.mouse.move(1270, 790)
def s3(pg):
    pg.click('.sdkh-cat[data-cat=subsets] .sdkh-cat-head'); pg.mouse.move(1270, 790); pg.wait_for_timeout(200)
    framed = pg.evaluate("[...document.querySelector('.sdkh-overlay').children].map((c,i)=>c.querySelector&&c.querySelector('.sdkh-frame')?i:-1).filter(i=>i>=0)")
    framed = [i - 1 for i in framed]   # the overlay's first child is the links layer
    best = None
    for i in framed:
        x, y = cell_xy(i); pg.mouse.move(x, y, steps=3); pg.wait_for_timeout(150)
        if pg.evaluate("document.querySelectorAll('.sdkh-hintcell').length"): best = i; break
    x, y = cell_xy(best if best is not None else framed[0]); pg.mouse.move(x, y, steps=3)
def s5(pg):
    pg.click('[data-act=assist]'); pg.wait_for_timeout(200)
    pg.click('[data-as=more]'); pg.wait_for_timeout(150); pg.click('[data-as=more]'); pg.mouse.move(1270, 790)

ANY_GRID_STYLE = """
html,body{background:#eef2f9!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif!important;color:#1e2a44}
header{display:none!important}
main{padding:0!important;gap:0!important;position:relative;width:1280px;height:800px;display:block!important}
#cap{position:absolute;left:60px;top:36px;width:640px}
#cap h1{margin:0;font-size:32px;line-height:1.15;letter-spacing:-.3px}
#cap p{margin:10px 0 0;font-size:18px;color:#4a5672;line-height:1.4}
.board-wrap{position:absolute;left:60px;top:168px}
.board{--size:600px!important;box-shadow:0 10px 30px rgba(40,60,110,.12)}
.legend{display:none}
.panel{position:absolute;left:760px;top:36px;width:440px;flex:none!important}
#paste,.keys,#status{display:none}
.cell.sel:not(.look):not(.unit):not(.single){background:transparent!important}
"""
def any_grid_shot(p):
    prof = tempfile.mkdtemp()
    ctx = p.chromium.launch_persistent_context(prof, channel='chromium', headless=True,   # the full Chromium: the headless shell has no extensions
                                                args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'],
                                               viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker'); eid = sw.url.split('/')[2]
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'chrome-extension://{eid}/solver.html'); pg.wait_for_timeout(600)
    pg.fill('#paste', open(os.path.join(TOOLS, 'grid-16x16.txt')).read().strip()); pg.click('#load'); pg.wait_for_timeout(2500)
    pg.click('[data-act=optimized]'); pg.wait_for_timeout(2500)
    pg.click('[data-act=assist]'); pg.wait_for_timeout(400)
    pg.click('[data-act=more]'); pg.click('[data-act=more]'); pg.wait_for_timeout(400)
    pg.add_style_tag(content=ANY_GRID_STYLE)
    pg.evaluate("""()=>{const c=document.createElement('div');c.id='cap';c.innerHTML='<h1>Any grid, up to 16×16</h1><p>Paste or type a sudoku from anywhere — 4×4 to 16×16 — and get the same help: notes, step by step assist, Finish grid.</p>';
      document.querySelector('main').prepend(c);document.querySelector('#adv').open=false;}""")
    pg.mouse.move(1270, 790); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(STORE, 'screenshot-4-any-grid.png')); print('screenshot-4-any-grid', errs or 'ok')
    ctx.close(); shutil.rmtree(prof, ignore_errors=True)

def marquee(p):
    shot = os.path.join(TOOLS, 'marquee-shot.png')
    Image.open(os.path.join(STORE, 'screenshot-2-assist.png')).convert('RGB').crop((150, 70, 1120, 700)).save(shot)
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 560})
    pg.goto('file://' + os.path.join(TOOLS, 'marquee.html')); pg.wait_for_timeout(400)
    raw = os.path.join(tempfile.mkdtemp(), 'marquee.png'); pg.screenshot(path=raw); b.close()
    Image.open(raw).convert('RGB').save(os.path.join(STORE, 'marquee-promo-1400x560.png')); os.remove(shot)
    print('marquee-promo-1400x560 ok')

with sync_playwright() as p:
    if want(1): panel_shot(p, 'screenshot-1-overview', state(A), 'Help at your own level',
                           'From filling your notes to every hint at once: four levels of help, and you choose how much.', s1, adv=True)
    if want(2): panel_shot(p, 'screenshot-2-assist', state(A), 'Step by step: where, what, why',
                           'Assist always shows the easiest hint left: where to look, then the technique, then the reasoning on the grid.', s2)
    if want(3): panel_shot(p, 'screenshot-3-reasoning', state(A), 'Every technique, with its reasoning',
                           'Hover a hint: where it applies, the notes it erases, and the earlier hints it needs (red).', s3, adv=True)
    if want(4): any_grid_shot(p)
    if want(5): panel_shot(p, 'screenshot-5-expert', open(os.path.join(TOOLS, 'grid-expert-fish.json')).read(), 'Stuck? Expert techniques, explained',
                           'X-wing, wings, long chains, forcing chains… used only when nothing simpler helps, step by step.', s5)
    if want(2) or want('marquee'): marquee(p)

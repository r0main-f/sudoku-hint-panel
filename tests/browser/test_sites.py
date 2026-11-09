#!/usr/bin/env python3
"""The panel on other sudoku sites, end to end, in Chromium with the extension loaded.
Each site is served from a stand-in page (site_mocks.py) under its real address, so the
manifest's matches, the frames (Web Sudoku) and the site adapters all run as on the real site.
  python3 tests/browser/test_sites.py [site…]      (needs Playwright + Chromium)"""
import os, sys, tempfile
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from site_mocks import PAGES
EXT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'extension')
only = sys.argv[1:]
fails = []
def check(cond, what):
    print(('   ✓ ' if cond else '   ✗ ') + what)
    if not cond: fails.append(what)
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel='chromium', headless=True,
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 1300, 'height': 860})
    def route(r):
        url = r.request.url.split('#')[0]
        html = PAGES.get(url) or PAGES.get(url.rstrip('/') + '/') or PAGES.get(url.rstrip('/'))
        if html is not None: r.fulfill(body=html, content_type='text/html')
        elif r.request.resource_type in ('document', 'sub_frame'): r.fulfill(body='<html></html>', content_type='text/html')
        else: r.abort()
    ctx.route('**/*', route)
    for url in [u for u in PAGES if not u.startswith('https://west.')]:
        if only and not any(o in url for o in only): continue
        print('==', url)
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(1800)
        frame = pg.frames[1] if 'websudoku' in url else pg.main_frame
        ui = frame   # the panel: in the top page, or in the grid's frame when the top page is a frameset (Web Sudoku)
        t = lambda s: ui.evaluate(f"(document.querySelector('{s}')||{{}}).textContent||''")
        check(ui.evaluate("!!document.querySelector('.sdkh2-panel') && !document.querySelector('.sdkh2-panel').classList.contains('idle') && document.querySelector('.sdkh2-panel').getBoundingClientRect().width > 100"), 'panel shown and active on the grid')
        check(t('.sdkh2-grade') == '7/10', f"difficulty badge ({t('.sdkh2-grade')})")
        check('Single options20' in t('.sdkh2-cats'), 'hints counted')
        if 'livesudoku' in url:   # a wrong digit typed by the player is named, and the hints come back once it's gone
            frame.evaluate("selectcell(0); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'9',keyCode:57,which:57,bubbles:true}))"); pg.wait_for_timeout(900)
            check('A digit on the board is wrong' in t('.sdkh2-card') and 'r1c1' in t('.sdkh2-card'), 'wrong digit named: ' + t('.sdkh2-card')[30:120])
            frame.evaluate("selectcell(0); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',keyCode:46,which:46,bubbles:true}))"); pg.wait_for_timeout(900)
            check(t('.sdkh2-grade') == '7/10' and not t('.sdkh2-card'), 'hints back after fixing it')
        # notes: written into the game where the site has notes (NYT), drawn over the grid elsewhere
        ui.click('.sdkh2-panel [data-act=opt]'); pg.wait_for_timeout(3000 if 'nytimes' in url else 500)
        NOTES_JS = {'livesudoku': "document.querySelectorAll('#playtable .hintnumber').length",
                    'sudokuonline': "document.querySelectorAll('.cell .annotation.on').length"}
        site_notes = next((js for k, js in NOTES_JS.items() if k in url), None)
        if site_notes:
            pg.wait_for_timeout(2500)
            n = frame.evaluate(site_notes)
            check(n > 100 and 'Optimized notes written' in t('.sdkh2-status'), f'Optimized notes typed into the game ({n} notes)')
            if 'livesudoku' in url:   # one candidate can't be a pencil mark there: drawn over the grid instead
                pinned = frame.evaluate("document.querySelectorAll('.sdkh2-overlay .sdkh2-notes i.plain').length")
                check(pinned > 0 and 'drawn over the grid instead' in t('.sdkh2-status'), f'single candidates drawn over the grid ({pinned})')
        elif 'nytimes' in url:
            n = frame.evaluate("Object.values(JSON.parse(localStorage.getItem('xwd-sudoku-easy')).manualCandidates).reduce((t,c)=>t+Object.values(c).filter(Boolean).length,0)")
            check(n > 100 and 'Optimized notes written' in t('.sdkh2-status'), f'Optimized notes typed into the game ({n} notes)')
            check(frame.evaluate("document.querySelector('.su-keyboard__mode.normal').classList.contains('normalMode')"), 'game back in Normal mode after writing notes')
            pg.wait_for_timeout(800)
        else:
            plain = frame.evaluate("document.querySelectorAll('.sdkh2-overlay .sdkh2-notes i.plain').length")
            check(plain > 50, f'Optimized notes drawn over the grid ({plain})')
            ui.click('.sdkh2-panel [data-act=opt]'); pg.wait_for_timeout(300)
        ui.click('.sdkh2-panel [data-act=assist]'); pg.wait_for_timeout(300)
        ui.click('.sdkh2-card [data-act=more]'); ui.click('.sdkh2-card [data-act=more]'); pg.wait_for_timeout(400)
        check(t('.sdkh2-card').startswith('Why'), 'assist explains the first hint: ' + t('.sdkh2-card')[3:60])
        check(frame.evaluate("document.querySelectorAll('.sdkh2-overlay .sdkh2-cell').length") > 5, 'overlay drawn on the grid')
        ui.click('.sdkh2-card [data-act=apply]'); pg.wait_for_timeout(700)
        check('Done' in t('.sdkh2-status'), 'Apply typed the digit in the game')
        ui.click('.sdkh2-panel [data-act=assist]')
        ui.click('.sdkh2-panel [data-act=finish]'); ui.click('.sdkh2-panel [data-act=finish]'); pg.wait_for_timeout(5000)
        check(t('.sdkh2-grade') == '0/10' and 'Finished' in t('.sdkh2-status'), 'Finish grid solved it in the game')
        check(not errs, 'no page errors ' + (str(errs) if errs else ''))
        pg.close()
    ctx.close()
print('\n' + (f'✗ {len(fails)} failed' if fails else '✓ all sites passed'))
sys.exit(1 if fails else 0)

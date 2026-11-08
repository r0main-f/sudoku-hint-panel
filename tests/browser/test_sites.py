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
        t = lambda s: pg.evaluate(f"(document.querySelector('{s}')||{{}}).textContent||''")
        check(not pg.evaluate("document.querySelector('.sdkh2-panel').classList.contains('idle')"), 'panel active on the grid')
        check(t('.sdkh2-grade') == '7/10', f"difficulty badge ({t('.sdkh2-grade')})")
        check('Single options20' in t('.sdkh2-cats'), 'hints counted')
        pg.click('.sdkh2-panel [data-act=assist]'); pg.wait_for_timeout(300)
        pg.click('.sdkh2-card [data-act=more]'); pg.click('.sdkh2-card [data-act=more]'); pg.wait_for_timeout(400)
        check('only place for 8 in row 1' in t('.sdkh2-card'), 'assist explains the first hint')
        check(frame.evaluate("document.querySelectorAll('.sdkh2-overlay .sdkh2-cell').length") > 5, 'overlay drawn on the grid')
        pg.click('.sdkh2-card [data-act=apply]'); pg.wait_for_timeout(700)
        check('Done' in t('.sdkh2-status'), 'Apply typed the digit in the game')
        pg.click('.sdkh2-panel [data-act=assist]')
        pg.click('.sdkh2-panel [data-act=finish]'); pg.click('.sdkh2-panel [data-act=finish]'); pg.wait_for_timeout(5000)
        check(t('.sdkh2-grade') == '0/10' and 'Finished' in t('.sdkh2-status'), 'Finish grid solved it in the game')
        check(not errs, 'no page errors ' + (str(errs) if errs else ''))
        pg.close()
    ctx.close()
print('\n' + (f'✗ {len(fails)} failed' if fails else '✓ all sites passed'))
sys.exit(1 if fails else 0)

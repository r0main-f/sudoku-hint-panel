# Stand-ins for each supported site's page, with the DOM and the input behaviour observed on the real sites (Nov 2026).
P='000041090004000006080000070000500000007300800002060305649802000721906000358000000'
def esc(s): return s.replace('`','')
NYT = """<!doctype html><html><head><meta charset=utf-8><style>
.su-board{display:grid;grid-template-columns:repeat(9,48px);width:432px;margin:40px}.su-cell{height:48px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font:24px sans-serif}
.su-cell.selected{background:#fe9}.su-keyboard{margin:0 40px}</style></head><body><h1>Sudoku</h1>
<div class="su-app__board-square su-board" id=b></div>
<div class="su-keyboard"><button class="su-keyboard__mode normal normalMode">Normal</button><button class="su-keyboard__mode candidate">Candidate</button>
<span id=nums></span><button class="su-keyboard__delete" aria-label="Clear cell">Clear</button></div>
<script>
const P='%P%'; let sel=-1, cand=false; const save={size:81,id:'2026-11-08',difficulty:'easy',cells:{},manualCandidates:{},autoCandidates:{},auto:false};
[...P].forEach((ch,i)=>{save.cells[i]={id:i,answer:0,prefilled:ch!=='0',...(ch!=='0'?{value:+ch}:{})};});
const b=document.getElementById('b');
function label(i){const c=save.cells[i];const r=Math.floor(i/9)+1,col=i%9+1;return `Row ${r}, column ${col}, `+(c.value?(c.prefilled?'prefilled ':'')+c.value:'empty');}
function draw(){[...b.children].forEach((el,i)=>{const c=save.cells[i];el.setAttribute('aria-label',label(i));el.className='su-cell'+(c.prefilled?' prefilled':'')+(i===sel?' selected':'');el.textContent=c.value||'';});localStorage.setItem('xwd-sudoku-easy',JSON.stringify(save));}
for(let i=0;i<81;i++){const el=document.createElement('div');el.dataset.cell=i;el.setAttribute('role','gridcell');el.addEventListener('pointerdown',()=>{sel=i;draw();});b.appendChild(el);}
const nums=document.getElementById('nums');
for(let d=1;d<=9;d++){const x=document.createElement('button');x.className='su-keyboard__number';x.setAttribute('aria-label','Number '+d);x.textContent=d;x.addEventListener('click',()=>{if(sel<0||save.cells[sel].prefilled)return;if(cand){const m=save.manualCandidates[sel]||(save.manualCandidates[sel]={});m[d]=!m[d];}else{save.cells[sel].value=d;}draw();});nums.appendChild(x);}
document.querySelector('.su-keyboard__delete').addEventListener('click',()=>{if(sel>=0&&!save.cells[sel].prefilled){delete save.cells[sel].value;draw();}});
document.querySelector('.candidate').addEventListener('click',e=>{cand=true;e.target.classList.add('candidateMode');document.querySelector('.normal').classList.remove('normalMode');});
document.querySelector('.normal').addEventListener('click',e=>{cand=false;e.target.classList.add('normalMode');document.querySelector('.candidate').classList.remove('candidateMode');});
draw();
</script></body></html>""".replace('%P%',P)

WEBSUDOKU_TOP = """<!doctype html><html><head><meta charset=utf-8></head><body style="margin:0"><h2 style="margin:8px">Web Sudoku</h2>
<iframe src="https://west.websudoku.com/?" width="560" height="560" frameborder=0 style="margin-left:20px"></iframe></body></html>"""
WEBSUDOKU_FRAME = """<!doctype html><html><head><meta charset=utf-8><style>input{width:44px;height:44px;font:22px sans-serif;text-align:center;border:1px solid #bbb} .s0{font-weight:bold;background:#eee}</style></head><body>
<form name=board><table id=puzzle_grid cellspacing=0>%ROWS%</table></form></body></html>"""
rows=''
for r in range(9):
    rows+='<tr>'
    for c in range(9):
        v=P[r*9+c]
        rows+= f'<td><input class=s0 size=2 autocomplete=off name=s{c}{r} readonly value="{v}" id="f{c}{r}"></td>' if v!='0' else f'<td><input class=d0 size=2 autocomplete=off name=g{c}{r} maxlength=1 id="f{c}{r}"></td>'
    rows+='</tr>'
WEBSUDOKU_FRAME=WEBSUDOKU_FRAME.replace('%ROWS%',rows)

SUDOKU_ONLINE = """<!doctype html><html><head><meta charset=utf-8><style>.sudotable td{width:46px;height:46px;border:1px solid #bbb;text-align:center}.sudo_field{font:22px sans-serif;outline:none}</style></head><body><h1>Sudoku Online Gratis</h1>
<table class="sudotable normal">%ROWS%</table>
<script>
function onkey(e){const el=e.target;if(el.classList.contains('no_select'))return;const k=e.keyCode;if(k>=49&&k<=57)el.textContent=String(k-48);else if(k===46||k===8)el.textContent='';}
function sudo_field_blur(i){}
</script></body></html>"""
rows=''
for r in range(9):
    rows+='<tr>'
    for c in range(9):
        i=r*9+c; v=P[i]
        cls='sudo_field sudo_input_field'+(' no_select' if v!='0' else '')
        rows+=f'<td><div id="sudo_input_{i}" data-index="{i}" data-x="{r}" data-y="{c}" class="{cls}" tabindex="{i+1}" onkeydown="onkey(event)" onblur="sudo_field_blur({i})">{v if v!="0" else ""}</div></td>'
    rows+='</tr>'
SUDOKU_ONLINE=SUDOKU_ONLINE.replace('%ROWS%',rows)

LIVESUDOKU = """<!doctype html><html><head><meta charset=utf-8><style>#playtable td{width:46px;height:46px;border:1px solid #bbb;text-align:center;font:22px sans-serif}</style></head>
<body onkeydown="return processkeySudoku(event)"><h1>Easy Sudoku</h1><table id=playtable class=width400desktop>%ROWS%</table>
<script>
let selectedcell=-1; function selectcell(i){selectedcell=i;}
function processkeySudoku(e){if(selectedcell<0)return true;const td=document.getElementById('td'+selectedcell);if(td.querySelector('.fixedcell'))return true;const k=e.keyCode;
 if(k>=49&&k<=57){td.innerHTML='<span class="varcell" style="color:#1F45FC;">'+(k-48)+'</span>';}else if(k===46||k===8){td.innerHTML='&nbsp;';}return false;}
</script></body></html>"""
rows=''
for r in range(9):
    rows+='<tr>'
    for c in range(9):
        i=r*9+c; v=P[i]
        inner=f'<span class="fixedcell" style="color:#000000;">{v}</span>' if v!='0' else '&nbsp;'
        rows+=f'<td id="td{i}" class="cellnormal" onmousedown="selectcell({i})">{inner}</td>'
    rows+='</tr>'
LIVESUDOKU=LIVESUDOKU.replace('%ROWS%',rows)

SUDOKUONLINE_IO = """<!doctype html><html><head><meta charset=utf-8><style>.grid{display:grid;grid-template-columns:repeat(9,48px);margin:30px}.cell{height:48px;border:1px solid #bbb;position:relative;font:22px sans-serif;display:flex;align-items:center;justify-content:center}
.annotations{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);font-size:10px}.annotation{visibility:hidden;display:flex}.annotation.on{visibility:visible}.cell.active{background:#def}</style></head><body><h1>Sudoku Online</h1><div class=grid id=g></div>
<script>
const P='%P%'; const g=document.getElementById('g');
for(let i=0;i<81;i++){const c=document.createElement('div');c.className='cell'+(P[i]!=='0'?' fixed':'');c.dataset.value=P[i]!=='0'?P[i]:'';c.dataset.celln=i;c.dataset.row=Math.floor(i/9);c.dataset.column=i%9;c.tabIndex=0;
 const an=document.createElement('div');an.className='annotations';for(let d=1;d<=9;d++){const a=document.createElement('div');a.className='annotation color-'+d;a.textContent=d;an.appendChild(a);}c.appendChild(an);
 const v=document.createTextNode(c.dataset.value);c.appendChild(v);
 c.addEventListener('click',()=>{document.querySelectorAll('.cell.active').forEach(x=>x.classList.remove('active'));c.classList.add('active');});
 c.addEventListener('keydown',e=>{if(c.classList.contains('fixed'))return;const k=e.keyCode;if(k>=49&&k<=57){c.dataset.value=String(k-48);v.textContent=c.dataset.value;}else if(k===8||k===46){c.dataset.value='';v.textContent='';}});
 g.appendChild(c);}
// one note, to check the panel reads the site's own notes
document.querySelector('.cell[data-celln="0"] .annotation.color-2').classList.add('on');
</script></body></html>""".replace('%P%',P)

PAGES = {
  'https://www.nytimes.com/puzzles/sudoku/easy': NYT,
  'https://www.websudoku.com/': WEBSUDOKU_TOP,
  'https://west.websudoku.com/?': WEBSUDOKU_FRAME,
  'https://www.sudoku-online.org/': SUDOKU_ONLINE,
  'https://www.livesudoku.com/en/sudoku/easy/': LIVESUDOKU,
  'https://www.sudokuonline.io/': SUDOKUONLINE_IO,
}

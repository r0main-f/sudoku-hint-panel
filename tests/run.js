// All engine tests:  node tests/run.js
const { execFileSync } = require('child_process');
let failed = 0;
for (const t of ['golden-9x9.js', 'sizes.js']) {
  try { process.stdout.write(execFileSync(process.execPath, [require('path').join(__dirname, t)], { encoding: 'utf8' })); }
  catch (e) { process.stdout.write((e.stdout || '') + (e.stderr || '')); failed++; }
}
process.exit(failed ? 1 : 0);

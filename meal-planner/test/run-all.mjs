// Runs every suite in series and exits non-zero if any fails. Series, not
// parallel: each one drives a real Chromium and they'd fight for the machine.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here).filter((f) => f.endsWith('.e2e.js')).sort();

let failed = [];
for (const suite of suites) {
  process.stdout.write(suite.padEnd(28));
  const res = spawnSync(process.execPath, [join(here, suite)], { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  const ok = res.status === 0;
  if (!ok) failed.push({ suite, out });
  console.log(ok ? 'ALL PASS' : 'FAILED');
}

if (failed.length) {
  for (const f of failed) {
    console.log(`\n===== ${f.suite} =====`);
    console.log(f.out.split('\n').filter((l) => /^FAIL|FAILURE|PAGE ERROR|Error/.test(l)).slice(0, 20).join('\n'));
  }
  console.log(`\n${failed.length} of ${suites.length} suites failed`);
  process.exit(1);
}
console.log(`\nall ${suites.length} suites pass`);

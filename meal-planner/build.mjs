// Turns the single source file into a deployable site.
//
// There is exactly one copy of the app — app/index.html — and it stays
// publishable as a Claude artifact. This script wraps it in the document
// scaffolding a real web host needs (doctype, head, manifest, config, service
// worker) and writes dist/. Nothing here edits the source.
//
//   node build.mjs
//
// Then deploy dist/ as a static site, with api/ai.ts as a function.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const app = readFileSync(join(root, 'app', 'index.html'), 'utf8');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#3F5730">
<meta name="description" content="Plan five dinners a week, build one grocery list, cook from your phone.">
<title>Meal Planner</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#14191A}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="config.js"></script>
</head>
<body>
${app}
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
</script>
</body>
</html>
`;

writeFileSync(join(dist, 'index.html'), page);

for (const file of ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png']) {
  const from = join(root, 'web', file);
  if (existsSync(from)) copyFileSync(from, join(dist, file));
  else console.warn(`  missing web/${file} — the build will work but the install prompt won't`);
}

// Where the Supabase details come from, in order:
//
//   1. web/config.js on disk — local development.
//   2. SUPABASE_URL / SUPABASE_ANON_KEY in the environment — a host's build.
//   3. Neither, and the app runs on-device only.
//
// The env-var path matters: web/config.js is gitignored, so without it a
// deploy would build the third case and quietly ship an app where the two of
// you each get a private list. That is the failure that looks like success.
const config = join(root, 'web', 'config.js');
const envUrl = process.env.SUPABASE_URL;
const envKey = process.env.SUPABASE_ANON_KEY;

if (existsSync(config)) {
  copyFileSync(config, join(dist, 'config.js'));
  console.log('  config from web/config.js');
} else if (envUrl && envKey) {
  writeFileSync(join(dist, 'config.js'),
    '// Generated at build time from the environment. Do not edit.\n' +
    'window.MP_CONFIG = ' + JSON.stringify({
      supabaseUrl: envUrl,
      supabaseAnonKey: envKey,
      aiEndpoint: process.env.AI_ENDPOINT || '/api/ai'
    }, null, 2) + ';\n');
  console.log('  config from SUPABASE_URL / SUPABASE_ANON_KEY');
} else {
  writeFileSync(join(dist, 'config.js'), '// No Supabase config — running on-device only.\nwindow.MP_CONFIG = null;\n');
  console.warn('');
  console.warn('  !! No Supabase config found. Built in ON-DEVICE mode:');
  console.warn('     no shared list, no accounts, no AI. Each browser keeps its own copy.');
  console.warn('     Set SUPABASE_URL and SUPABASE_ANON_KEY, or copy web/config.example.js');
  console.warn('     to web/config.js. See SETUP.md.');
  console.warn('');
}

console.log('built dist/ from app/index.html');

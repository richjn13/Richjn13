// Export and import. This is the migration path off the artifact runtime as
// well as the backup, so the properties that matter are: a snapshot round-trips
// without loss, merge never overwrites what's in front of you, importing the
// same backup twice doesn't double anything, and a backup from a newer version
// of the app is refused rather than half-read.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-backup.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item) => ({ item, quantity:'1', unit:'', section:'other', pantryStaple:false, flag:null, substitute:'' });
const mk = (id, name) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings:4,
  method:'Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:1,
  ingredients:[ing('garlic')], macros:{ calories:400, protein:20, carbs:30, fat:10 }, macrosSource:'entered'
});

const MEALS = [mk('m1','Traybake'), mk('m2','Curry')];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1',null,null,null,null], checkedItems:{}, cooked:{}, started:true };
const PANTRY = ['olive oil','salt'];
const HISTORY = [{ id:'h1', weekStart:'2025-12-29', archivedAt:1735000000000,
  meals:[{ id:'m1', name:'Traybake', tier:'often', servings:4, cookedOn:'2025-12-30' }] }];

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });

  await page.addInitScript(({ meals, week, pantryList, hist }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify(pantryList));
    localStorage.setItem('mp_history_v1', JSON.stringify(hist));
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true
    });
    window.claude = { use: () => Promise.resolve(null) };
  }, { meals: MEALS, week: WEEK, pantryList: PANTRY, hist: HISTORY });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);
  await page.click('button.tab:has-text("Import")');
  await page.waitForTimeout(300);

  // --- export carries everything, with a version stamp ---
  await page.click('button:has-text("Copy a backup")');
  await page.waitForTimeout(400);
  const backup = await page.evaluate(() => window.__copied || '');
  const parsed = JSON.parse(backup);
  check('export is versioned', parsed.schemaVersion, 1);
  check('export names the app', parsed.app, 'meal-planner');
  check('export carries the meals', parsed.meals.length, 2);
  check('export carries the pantry', parsed.pantry.length, 2);
  check('export carries the history', parsed.history.length, 1);
  check('export carries the current week', parsed.week.weekStart, '2026-01-05');
  check('a meal keeps its macros', parsed.meals[0].macros.calories, 400);
  check('and its ingredients', parsed.meals[0].ingredients[0].item, 'garlic');

  // --- a summary before anything is written ---
  const bigger = JSON.parse(backup);
  bigger.meals.push(mk('m3','Noodles'));
  bigger.pantry.push('tinned tomatoes');
  bigger.history.push({ weekStart:'2025-12-22', archivedAt:1734000000000, meals:[{ id:'m2', name:'Curry', tier:'often', servings:4, cookedOn:'2025-12-23' }] });
  // The copy of m1 in the backup is stale — merge must NOT bring this back.
  bigger.meals[0].name = 'STALE NAME FROM THE BACKUP';

  await page.fill('#import-data-input', JSON.stringify(bigger));
  await page.click('button:has-text("Check it")');
  await page.waitForTimeout(400);
  const summary = (await page.locator('.warnbox.info').last().innerText()).replace(/\s+/g,' ');
  check('preview counts the meals', summary.indexOf('3 meals') !== -1, true);
  check('preview counts the pantry', summary.indexOf('3 pantry items') !== -1, true);
  check('preview counts the weeks', summary.indexOf('2 filed weeks') !== -1, true);
  check('nothing written yet', await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).length), 2);

  // --- merge only adds ---
  await page.click('button:has-text("Add what’s missing")');
  await page.waitForTimeout(900);
  const afterMerge = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')));
  check('merge added the new meal', afterMerge.length, 3);
  check('merge left the existing meal alone', afterMerge.find(m => m.id === 'm1').name, 'Traybake');
  check('merge added the pantry item',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')).some(p => p.name === 'tinned tomatoes')), true);
  check('merge added the older week',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_history_v1')).length), 2);

  // --- and importing the same thing twice changes nothing ---
  await page.fill('#import-data-input', JSON.stringify(bigger));
  await page.click('button:has-text("Check it")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Add what’s missing")');
  await page.waitForTimeout(900);
  check('a second merge adds no meals',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).length), 3);
  check('a second merge adds no weeks',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_history_v1')).length), 2);
  check('a second merge adds no pantry items',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')).length), 3);

  // --- replace is behind a confirm, and really replaces ---
  const small = { schemaVersion:1, app:'meal-planner', meals:[mk('z9','Only Meal')], pantry:['salt'], history:[], week:null };
  await page.fill('#import-data-input', JSON.stringify(small));
  await page.click('button:has-text("Check it")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Replace everything")');
  await page.waitForTimeout(200);
  check('replace asks first', await page.locator('button:has-text("Yes, replace it all")').count(), 1);
  check('and has written nothing yet',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).length), 3);
  await page.click('button:has-text("Yes, replace it all")');
  await page.waitForTimeout(1200);
  const afterReplace = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')));
  check('replace left only the backup meals', afterReplace.length, 1);
  check('and it is the right one', afterReplace[0].name, 'Only Meal');
  check('replace cleared the history',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_history_v1')).length), 0);

  // --- refusals: junk, a foreign export, and a newer format ---
  await page.fill('#import-data-input', 'not json at all');
  await page.click('button:has-text("Check it")');
  await page.waitForTimeout(300);
  check('junk is refused', (await page.locator('.g-flag').last().innerText()).indexOf('valid JSON') !== -1, true);

  await page.fill('#import-data-input', JSON.stringify({ app:'something-else', meals:[] }));
  await page.click('button:has-text("Check it")');
  await page.waitForTimeout(300);
  check('another app\'s export is refused', (await page.locator('.g-flag').last().innerText()).indexOf('different app') !== -1, true);

  await page.fill('#import-data-input', JSON.stringify({ app:'meal-planner', schemaVersion: 99, meals:[mk('q1','Future')] }));
  await page.click('button:has-text("Check it")');
  await page.waitForTimeout(300);
  check('a newer format is refused rather than half-read',
    (await page.locator('.g-flag').last().innerText()).indexOf('newer version') !== -1, true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

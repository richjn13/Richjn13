// Macros are entered per serving and the batch/week figures are derived, so the
// arithmetic is what matters: per-serving x servings, summed across the week,
// and averaged per serving. Driven in Chromium with a stubbed AI adjustment.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-macros.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const mk = (id, name, servings, macros) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings,
  method:'Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients:[{ item:'butter', quantity:'2', unit:'tbsp', section:'dairy-and-chilled', pantryStaple:false, flag:null, substitute:'' }],
  macros
});

// 500 kcal x 4 servings = 2000; 600 x 2 = 1200. Week total 3200 over 6 servings
// -> average 533.3 per serving.
const MEALS = [
  mk('m1','Traybake', 4, { calories:500, protein:30, carbs:40, fat:20 }),
  mk('m2','Curry',    2, { calories:600, protein:20, carbs:50, fat:25 }),
  mk('m3','No Macros',4, { calories:'', protein:'', carbs:'', fat:'' })
];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1','m2','m3',null,null], checkedItems:{}, started:true };

// The adjust response omits carbs deliberately: a skipped estimate must not wipe
// a figure that was already filled in.
const ADJUSTED = {
  base:'x', method:'1. Heat the oil.', notes:'Swapped to oil.',
  macros: { calories: 450, protein: 31, fat: 15 },
  dietFlags: [],
  ingredients: [{ item:'olive oil', quantity:'2', unit:'tbsp', section:'other', pantryStaple:false, flag:null, substitute:'' }]
};

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

  await page.addInitScript(({ meals, week, adjusted }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify([]));
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, { json: () => Promise.resolve(adjusted) }) : null
    )};
  }, { meals: MEALS, week: WEEK, adjusted: ADJUSTED });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);

  // --- week rollup on This Week ---
  const weekBox = page.locator('.macro-week');
  const weekText = (await weekBox.innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('week totals all servings', weekText.indexOf('3200 kcal') !== -1, true);
  check('week counts 6 servings', weekText.indexOf('all 6 servings') !== -1, true);
  check('week shows an average serving', weekText.indexOf('533.3 kcal') !== -1, true);
  check('week flags the meal with no macros', weekText.indexOf('1 of these has no macros') !== -1, true);

  // --- per-meal readout in the recipe view ---
  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(200);
  await page.locator('.meal-row', { hasText: 'Traybake' }).first().locator('button:has-text("View")').click();
  await page.waitForTimeout(250);
  const detail = (await page.locator('.meal-detail').first().innerText()).replace(/\s+/g,' ').toLowerCase();
  check('per-serving figure shown', detail.indexOf('500 kcal') !== -1, true);
  check('whole-batch figure derived', detail.indexOf('2000 kcal') !== -1, true);
  check('batch names the serving count', detail.indexOf('all 4 servings') !== -1, true);
  check('grams carry their macro name', detail.indexOf('30g protein') !== -1, true);

  // --- editing: macros round-trip through the form and save ---
  await page.locator('.meal-row', { hasText: 'Traybake' }).first().locator('button:has-text("Edit")').click();
  await page.waitForTimeout(250);
  check('form loads per-serving calories', await page.inputValue('#f-macro-calories'), '500');
  check('form shows the batch total', (await page.locator('.macro-total').innerText()).indexOf('2000 kcal') !== -1, true);

  await page.fill('#f-macro-calories', '520');

  // --- an AI adjustment re-estimates macros, but must not clear what it omits ---
  await page.fill('#adjust-instruction', 'use olive oil instead of butter');
  await page.click('button:has-text("Apply")');
  await page.waitForTimeout(500);
  check('adjust updated calories', await page.inputValue('#f-macro-calories'), '450');
  check('adjust updated protein', await page.inputValue('#f-macro-protein'), '31');
  check('omitted carbs kept its existing value', await page.inputValue('#f-macro-carbs'), '40');

  await page.click('button:has-text("Save meal")');
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm1'));
  check('saved macros persist per serving', saved.macros.calories, 450);
  check('saved carbs untouched', saved.macros.carbs, 40);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

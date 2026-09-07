// This Week now carries the numbers you'd otherwise have to open a meal to
// find: per-serving macros, a per-meal breakdown, a target to measure against,
// pantry coverage per recipe, and an inline editor. Driven in Chromium.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-week.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item) => ({ item, quantity:'1', unit:'', section:'other', pantryStaple:false, flag:null, substitute:'' });
const mk = (id, name, servings, macros, items) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings,
  method:'Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients: items.map(ing), macros
});

// Traybake: 4 of its 8 ingredients are covered by the pantry -> 50%.
// Curry: 1 of 4 -> 25%. Salad has no macros at all.
const MEALS = [
  mk('m1','Traybake', 4, { calories:500, protein:30, carbs:40, fat:20 },
     ['olive oil','salt','black pepper','garlic','butter beans','red onion','thyme','lemon']),
  mk('m2','Curry', 2, { calories:600, protein:20, carbs:50, fat:25 },
     ['coconut milk','chickpeas','curry powder','salt']),
  mk('m3','Salad', 4, { calories:'', protein:'', carbs:'', fat:'' },
     ['lettuce','cucumber'])
];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1','m2','m3',null,null], checkedItems:{}, started:true };
const PANTRY = ['olive oil','salt','black pepper','garlic'];

const ESTIMATE = { calories: 300, protein: 8, carbs: 20, fat: 15 };

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}
const slot = (page, name) => page.locator('.slot-wrap', { hasText: name }).first();

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });

  await page.addInitScript(({ meals, week, pantryList, estimate }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify(pantryList));
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, { json: () => Promise.resolve(estimate) }) : null
    )};
  }, { meals: MEALS, week: WEEK, pantryList: PANTRY, estimate: ESTIMATE });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);

  // --- per-slot macros and pantry coverage ---
  const tray = slot(page, 'Traybake');
  const trayText = (await tray.innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('slot shows the per-serving figure', trayText.indexOf('500 kcal') !== -1, true);
  check('slot names the serving count', trayText.indexOf('4 servings') !== -1, true);
  check('slot shows pantry coverage percentage', trayText.indexOf('50% in pantry') !== -1, true);
  check('slot counts the covered ingredients', trayText.indexOf('4 of 8 ingredients') !== -1, true);

  const curryText = (await slot(page, 'Curry').innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('coverage is per meal, not global', curryText.indexOf('25% in pantry') !== -1, true);

  const saladText = (await slot(page, 'Salad').innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('a meal with no macros says so on the slot', saladText.indexOf('no macros yet') !== -1, true);

  // --- per-meal breakdown table ---
  check('breakdown is closed by default', await page.locator('.macro-table').count(), 0);
  await page.click('button:has-text("Show per-meal breakdown")');
  await page.waitForTimeout(250);
  check('breakdown opens', await page.locator('.macro-table').count(), 1);
  const table = (await page.locator('.macro-table').innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('table gives the batch total per meal', table.indexOf('2000 kcal') !== -1, true);
  check('table carries the curry batch too', table.indexOf('1200 kcal') !== -1, true);
  check('table footer holds the week total', table.indexOf('3200 kcal') !== -1, true);
  check('table flags the meal with nothing filled in', table.indexOf('not filled in') !== -1, true);

  // --- targets ---
  await page.click('button:has-text("Set a target")');
  await page.waitForTimeout(250);
  await page.fill('#target-calories', '550');
  await page.click('button:has-text("Save target")');
  await page.waitForTimeout(500);
  const savedTargets = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).macroTargets);
  check('target persisted to the week', savedTargets.calories, 550);
  // 500/550 = 91% (on), 600/550 = 109% (on)
  check('slot compares against the target', (await slot(page, 'Traybake').innerText()).indexOf('91% of target') !== -1, true);
  const table2 = (await page.locator('.macro-table').innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('table gains a vs-target column', table2.indexOf('vs target') !== -1, true);
  check('table shows the curry over target', table2.indexOf('109%') !== -1, true);

  // --- inline tweak: servings and macros, saved from This Week ---
  await slot(page, 'Curry').locator('button:has-text("tweak")').click();
  await page.waitForTimeout(300);
  check('editor loads the current servings', await page.inputValue('#slot-servings'), '2');
  check('editor loads the current macros', await page.inputValue('#slot-macro-calories'), '600');
  await page.fill('#slot-servings', '3');
  await page.fill('#slot-macro-calories', '540');
  await page.click('.slot-edit button:has-text("Save")');
  await page.waitForTimeout(600);
  const curry = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm2'));
  check('servings saved from the week view', curry.servings, 3);
  check('macros saved from the week view', curry.macros.calories, 540);
  check('a hand edit is not labelled an estimate', curry.macrosSource, 'entered');
  check('editor closed after saving', await page.locator('.slot-edit').count(), 0);

  // --- estimating into the editor leaves the record alone until you save ---
  await slot(page, 'Salad').locator('button:has-text("tweak")').click();
  await page.waitForTimeout(300);
  await page.click('button:has-text("Estimate from ingredients")');
  await page.waitForTimeout(600);
  check('estimate lands in the editor', await page.inputValue('#slot-macro-calories'), '300');
  const saladBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm3'));
  check('estimate is not written until saved', saladBefore.macros.calories, '');
  await page.click('.slot-edit button:has-text("Cancel")');
  await page.waitForTimeout(300);
  const saladAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm3'));
  check('cancel really cancels', saladAfter.macros.calories, '');

  // --- rejecting a nonsense serving count rather than saving it ---
  await slot(page, 'Traybake').locator('button:has-text("tweak")').click();
  await page.waitForTimeout(300);
  await page.fill('#slot-servings', '0');
  await page.click('.slot-edit button:has-text("Save")');
  await page.waitForTimeout(400);
  check('zero servings is refused', (await page.locator('.slot-edit .warnbox').innerText()).indexOf('at least 1') !== -1, true);
  const trayStill = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm1'));
  check('and nothing was written', trayStill.servings, 4);

  // --- coverage also shows in the recipe view, per ingredient ---
  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(250);
  await page.locator('.meal-row', { hasText: 'Traybake' }).first().locator('button:has-text("View")').click();
  await page.waitForTimeout(300);
  const detail = page.locator('.meal-detail').first();
  check('covered ingredients are tagged', await detail.locator('.ing-cover').count(), 4);
  check('detail lists what is still to buy', (await detail.innerText()).toLowerCase().indexOf('still to buy') !== -1, true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

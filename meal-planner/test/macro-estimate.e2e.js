// A meal saved before macros existed has none, and the old build simply hid the
// section — which reads as "this app doesn't do macros". These checks pin the
// replacement: the section is always there, it says what's missing, and it can
// fill itself in from the ingredients.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-estimate.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const mk = (id, name, macros) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings:4,
  method:'Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients:[{ item:'butter beans', quantity:'2', unit:'tins', section:'tins-and-dry-goods', pantryStaple:false, flag:null, substitute:'' }],
  macros: macros || { calories:'', protein:'', carbs:'', fat:'' }
});

// Two legacy meals with no macros, one that already has them by hand.
const MEALS = [
  mk('m1','Traybake'),
  mk('m2','Curry'),
  Object.assign(mk('m3','Known'), { macros:{ calories:400, protein:20, carbs:30, fat:10 }, macrosSource:'entered' })
];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1',null,null,null,null], checkedItems:{}, started:true };

const ESTIMATE = { calories: 480, protein: 22, carbs: 55, fat: 12 };

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

  await page.addInitScript(({ meals, week, estimate }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify([]));
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, { json: () => Promise.resolve(estimate) }) : null
    )};
  }, { meals: MEALS, week: WEEK, estimate: ESTIMATE });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);

  // --- This Week says so rather than showing nothing at all ---
  const weekText = (await page.locator('.macro-week').innerText()).toLowerCase();
  check('week names the gap instead of hiding', weekText.indexOf('none of this week’s picks have macros') !== -1, true);

  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(200);

  // --- the Meals page offers to fill the gap in one go ---
  const banner = (await page.locator('.warnbox.info').first().innerText()).toLowerCase();
  check('meals page counts what is missing', banner.indexOf('2 meals have no macros') !== -1, true);

  // --- clicking a meal shows a Macros section even with nothing in it ---
  await page.locator('.meal-row', { hasText: 'Traybake' }).first().locator('.m-name-btn').click();
  await page.waitForTimeout(250);
  const detail = page.locator('.meal-detail').first();
  check('macros section is present when empty', (await detail.innerText()).toLowerCase().indexOf('macros') !== -1, true);
  check('says nothing is filled in', (await detail.innerText()).toLowerCase().indexOf('nothing filled in yet') !== -1, true);
  check('offers an estimate button', await detail.locator('button:has-text("Estimate with AI")').count(), 1);

  // --- estimating writes to the saved meal, no form round-trip ---
  await detail.locator('button:has-text("Estimate with AI")').click();
  await page.waitForTimeout(600);
  const afterText = (await page.locator('.meal-detail').first().innerText()).replace(/\s+/g,' ').toLowerCase();
  check('per-serving estimate shown', afterText.indexOf('480 kcal') !== -1, true);
  check('batch figure derived from it', afterText.indexOf('1920 kcal') !== -1, true);
  check('estimate is labelled as an estimate', afterText.indexOf('estimated from the ingredients') !== -1, true);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm1'));
  check('estimate persisted to the meal', saved.macros.calories, 480);
  check('estimate marked as such on the record', saved.macrosSource, 'estimate');

  // --- a hand-entered meal is never labelled an estimate ---
  await page.locator('.meal-row', { hasText: 'Known' }).first().locator('.m-name-btn').click();
  await page.waitForTimeout(250);
  const knownText = (await page.locator('.meal-detail').first().innerText()).toLowerCase();
  check('hand-entered macros carry no estimate caveat', knownText.indexOf('estimated from the ingredients') === -1, true);

  // --- bulk: the remaining meal gets filled in too ---
  await page.click('button:has-text("Estimate all")');
  await page.waitForTimeout(1200);
  const curry = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm2'));
  check('bulk estimate filled the last gap', curry.macros.calories, 480);
  check('banner gone once nothing is missing', await page.locator('.warnbox.info').count(), 0);

  // --- typing a number by hand clears the estimate label ---
  await page.locator('.meal-row', { hasText: 'Traybake' }).first().locator('button:has-text("Edit")').click();
  await page.waitForTimeout(300);
  await page.fill('#f-macro-calories', '505');
  await page.click('button:has-text("Save meal")');
  await page.waitForTimeout(500);
  const edited = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm1'));
  check('hand edit saved', edited.macros.calories, 505);
  check('hand edit outranks the estimate label', edited.macrosSource, 'entered');

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

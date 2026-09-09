// Cook mode's per-step ingredient checklist. The matching is the risky part:
// "add the butter beans" must not put a block of dairy butter on the step, and
// "melt the butter, then add the butter beans" must show both.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-checklist.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item, quantity, unit, flag) => ({ item, quantity, unit, section:'other', pantryStaple:false, flag: flag||null, substitute: flag ? 'use oil instead' : '' });

const METHOD = [
  '1. Heat the oven and bring a pan to the boil.',            // "oil" must not match "boil"
  '2. Melt the butter, then tip in the butter beans.',        // both butter AND butter beans
  '3. Add the beans to the tray with the red onion.',         // head-noun fallback: "beans", "onion"
  '4. Roast for 25 minutes.',                                 // nothing at all
  '5. Squeeze over the lemon and serve.'
].join('\n');

const MEALS = [{
  id:'m1', name:'Butter Bean Traybake', base:'butter beans', effort:'Low', effortMinutes:30, tier:'often',
  servings:4, method:METHOD, notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients:[
    ing('butter','20','g','cow-milk'),
    ing('butter beans','2','tins'),
    ing('red onion','1',''),
    ing('olive oil','2','tbsp'),
    ing('lemon','1','')
  ],
  macros:{ calories:'', protein:'', carbs:'', fat:'' }
}];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1',null,null,null,null], checkedItems:{}, started:true };

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}
const names = async (page) => (await page.locator('.cook-step-ing .cook-ing-name').allInnerTexts()).map(t => t.trim());

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport:{ width:414, height:860 } });
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });

  await page.addInitScript(({ meals, week }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify([]));
    localStorage.setItem('mp_history_v1', JSON.stringify([]));
    window.claude = { use: () => Promise.resolve(null) };
  }, { meals: MEALS, week: WEEK });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);
  await page.locator('.slot-wrap', { hasText: 'Traybake' }).first().locator('button:has-text("Cook")').click();
  await page.waitForTimeout(300);

  // --- the prep screen is a checklist of everything ---
  check('prep lists every ingredient', await page.locator('.cook-ing-row').count(), 5);
  check('prep counts what is out', (await page.locator('.cook-label').innerText()).toLowerCase().indexOf('0 of 5 out') !== -1, true);
  await page.locator('.cook-ing-row', { hasText: 'lemon' }).locator('input[type="checkbox"]').check();
  await page.waitForTimeout(250);
  check('ticking one counts it', (await page.locator('.cook-label').innerText()).toLowerCase().indexOf('1 of 5 out') !== -1, true);
  check('a ticked row is marked used', await page.locator('.cook-ing-row.used').count(), 1);

  // --- step 1: "bring to the boil" must not drag in olive oil ---
  await page.click('button:has-text("Start cooking")');
  await page.waitForTimeout(250);
  check('step 1 matches nothing', await page.locator('.cook-step-ing').count(), 0);
  check('and says so on the toggle',
    (await page.locator('.cook-showall').innerText()).indexOf('Nothing to add here') !== -1, true);

  // --- step 2: butter AND butter beans, each on its own ---
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(250);
  const s2 = await names(page);
  check('step 2 has exactly two ingredients', s2.length, 2);
  check('step 2 includes the dairy butter', s2.indexOf('butter') !== -1, true);
  check('step 2 includes the butter beans', s2.indexOf('butter beans') !== -1, true);

  // --- step 3: "the beans" and "red onion" via the head noun, NOT butter ---
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(250);
  const s3 = await names(page);
  check('step 3 matches two things', s3.length, 2);
  check('"the beans" resolves to butter beans', s3.indexOf('butter beans') !== -1, true);
  check('and picks up the red onion', s3.indexOf('red onion') !== -1, true);
  check('dairy butter is NOT dragged in by "beans"', s3.indexOf('butter'), -1);

  // --- ticking on a step carries back to the prep list ---
  await page.locator('.cook-step-ing .cook-ing-row', { hasText: 'red onion' }).locator('input[type="checkbox"]').check();
  await page.waitForTimeout(250);
  check('step tick registers', await page.locator('.cook-step-ing .cook-ing-row.used').count(), 1);
  check('and the step counter moves',
    (await page.locator('.cook-step-ing .cook-label').innerText()).toLowerCase().indexOf('1 of 2 in') !== -1, true);

  // --- the full list is one tap away, and shares the same ticks ---
  await page.click('button:has-text("Show the full list")');
  await page.waitForTimeout(250);
  check('full list shows everything', await page.locator('.cook-step-ing .cook-ing-row').count(), 5);
  check('both earlier ticks are still there', await page.locator('.cook-step-ing .cook-ing-row.used').count(), 2);
  await page.click('button:has-text("Just this step")');
  await page.waitForTimeout(250);
  check('and back to just the step', await page.locator('.cook-step-ing .cook-ing-row').count(), 2);

  // --- a tick is one interaction, not two (the click/change double-fire trap) ---
  const before = await page.locator('.cook-step-ing .cook-ing-row.used').count();
  await page.locator('.cook-step-ing .cook-ing-row', { hasText: 'butter beans' }).locator('input[type="checkbox"]').check();
  await page.waitForTimeout(300);
  check('one tap ticks exactly one row', await page.locator('.cook-step-ing .cook-ing-row.used').count(), before + 1);

  // --- going back preserves what is ticked ---
  await page.click('button:has-text("Back")');
  await page.waitForTimeout(250);
  const s2Again = await page.locator('.cook-step-ing .cook-ing-row.used .cook-ing-name').allInnerTexts();
  check('step 2 remembers the butter beans tick', s2Again.map(t=>t.trim()).indexOf('butter beans') !== -1, true);

  // --- ticks are for this cook only; reopening starts clean ---
  await page.click('.close-x');
  await page.waitForTimeout(300);
  await page.locator('.slot-wrap', { hasText: 'Traybake' }).first().locator('button:has-text("Cook")').click();
  await page.waitForTimeout(300);
  check('a fresh cook starts with nothing ticked', await page.locator('.cook-ing-row.used').count(), 0);
  check('and nothing was written to the meal',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1'))[0].used === undefined), true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

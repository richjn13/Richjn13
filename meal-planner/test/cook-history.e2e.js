// Cook mode and the week log. Two things matter most here: the step parser must
// not double up numbering that's already in the written method, and marking a
// meal cooked has to land in BOTH places — on the meal (which the rotation
// rules read) and on the week (which History files) — or the two disagree.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-cook.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item, quantity, unit, flag) => ({ item, quantity, unit, section:'other', pantryStaple:false, flag: flag||null, substitute: flag ? 'use a plant-based version' : '' });

// Deliberately messy numbering: "1." on one line, "Step 2:" on another, a bullet
// on a third, and a blank line in the middle.
const METHOD = [
  '1. Heat the oven to 200C.',
  '',
  'Step 2: Tip the beans into a tray.',
  '- Roast for 25 minutes.',
  '4) Squeeze over the lemon and serve.'
].join('\n');

const MEALS = [
  { id:'m1', name:'Butter Bean Traybake', base:'butter beans', effort:'Low', effortMinutes:30, tier:'often',
    servings:4, method:METHOD, notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:2,
    ingredients:[ing('butter beans','2','tins'), ing('butter','20','g','cow-milk'), ing('lemon','1','')],
    macros:{ calories:500, protein:30, carbs:40, fat:20 } },
  { id:'m2', name:'Curry', base:'chickpeas', effort:'Low', effortMinutes:20, tier:'often', servings:4,
    method:'Cook it all.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
    ingredients:[ing('chickpeas','1','tin')], macros:{ calories:'', protein:'', carbs:'', fat:'' } }
];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1','m2',null,null,null], checkedItems:{}, started:true };

const d = new Date();
const TODAY = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');

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

  await page.addInitScript(({ meals, week }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify([]));
    localStorage.setItem('mp_history_v1', JSON.stringify([]));
    window.claude = { use: () => Promise.resolve(null) };
  }, { meals: MEALS, week: WEEK });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);

  // --- cook mode opens on a prep screen, not straight into step 1 ---
  await page.locator('.slot-wrap', { hasText: 'Traybake' }).first().locator('button:has-text("Cook")').click();
  await page.waitForTimeout(300);
  check('cook mode opened', await page.locator('#cook-overlay').count(), 1);
  const prep = (await page.locator('.cook-body').innerText()).replace(/\s+/g,' ');
  check('prep screen lists the ingredients', prep.indexOf('butter beans') !== -1, true);
  check('prep screen carries the allergen flag', prep.toLowerCase().indexOf('cow') !== -1, true);
  check('prep screen says what it makes', prep.indexOf('4 servings') !== -1, true);
  check('first button invites you to start', await page.locator('button:has-text("Start cooking")').count(), 1);

  // --- steps: numbering is stripped and re-applied, blank lines dropped ---
  await page.click('button:has-text("Start cooking")');
  await page.waitForTimeout(250);
  check('step 1 of 4', (await page.locator('.cook-progress').innerText()).trim().toLowerCase(), 'step 1 of 4');
  check('step 1 text has no leftover numbering', (await page.locator('.cook-step-text').innerText()).trim(), 'Heat the oven to 200C.');
  check('the number is rendered separately', (await page.locator('.cook-step-num').innerText()).trim(), '1');

  await page.click('button:has-text("Next")');
  await page.waitForTimeout(200);
  check('"Step 2:" prefix stripped', (await page.locator('.cook-step-text').innerText()).trim(), 'Tip the beans into a tray.');
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(200);
  check('bullet prefix stripped', (await page.locator('.cook-step-text').innerText()).trim(), 'Roast for 25 minutes.');
  check('and renumbered in order', (await page.locator('.cook-step-num').innerText()).trim(), '3');

  // --- Back works ---
  await page.click('button:has-text("Back")');
  await page.waitForTimeout(200);
  check('Back steps backwards', (await page.locator('.cook-step-num').innerText()).trim(), '2');
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(200);
  check('last step reached', (await page.locator('.cook-step-text').innerText()).trim(), 'Squeeze over the lemon and serve.');
  check('the last step offers to log it', await page.locator('button:has-text("Done — mark as cooked")').count(), 1);

  // --- finishing writes to the meal AND the week ---
  await page.click('button:has-text("Done — mark as cooked")');
  await page.waitForTimeout(600);
  check('cook mode closed', await page.locator('#cook-overlay').count(), 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm1'));
  check('meal records the date', saved.lastCooked, TODAY);
  check('meal count went up', saved.timesCooked, 3);
  const wk = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')));
  check('the week records it too', wk.cooked.m1, TODAY);
  check('the slot shows it as cooked',
    await page.locator('.slot-wrap', { hasText: 'Traybake' }).first().locator('.chip.cooked').count(), 1);

  // --- a meal with a one-line method still works ---
  await page.locator('.slot-wrap', { hasText: 'Curry' }).first().locator('button:has-text("Cook")').click();
  await page.waitForTimeout(300);
  await page.click('button:has-text("Start cooking")');
  await page.waitForTimeout(250);
  check('single-step method gives one step', (await page.locator('.cook-progress').innerText()).trim().toLowerCase(), 'step 1 of 1');
  await page.click('button:has-text("Close"), .close-x');
  await page.waitForTimeout(300);
  check('closing without logging leaves it uncooked',
    await page.evaluate(() => (JSON.parse(localStorage.getItem('mp_week_v1')).cooked || {}).m2 || null), null);

  // --- starting a new week files the old one ---
  await page.click('button:has-text("Start a new week")');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Yes, start fresh")');
  await page.waitForTimeout(700);
  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_history_v1')));
  check('one week filed', hist.length, 1);
  check('it kept the week start', hist[0].weekStart, '2026-01-05');
  check('it kept both meals', hist[0].meals.length, 2);
  check('it recorded which was cooked', hist[0].meals.find(m => m.id === 'm1').cookedOn, TODAY);
  check('and which was not', hist[0].meals.find(m => m.id === 'm2').cookedOn, '');
  check('names are snapshotted, not referenced', hist[0].meals.find(m => m.id === 'm1').name, 'Butter Bean Traybake');
  const freshWeek = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')));
  check('the new week starts with nothing cooked', Object.keys(freshWeek.cooked).length, 0);

  // --- History tab shows it ---
  await page.click('button.tab:has-text("History")');
  await page.waitForTimeout(300);
  const histText = (await page.locator('.hist-week').first().innerText()).replace(/\s+/g,' ');
  check('history names the week', histText.indexOf('Week of 5 Jan 2026') !== -1, true);
  check('history counts what was cooked', histText.indexOf('1 of 2 cooked') !== -1, true);
  check('most-cooked summary appears', (await page.locator('.pantry-item').first().innerText()).indexOf('Traybake') !== -1, true);

  // --- renaming a meal must not rewrite what history says you ate ---
  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(250);
  await page.locator('.meal-row', { hasText: 'Traybake' }).first().locator('button:has-text("Edit")').click();
  await page.waitForTimeout(300);
  await page.fill('#f-name', 'Something Else Entirely');
  await page.click('button:has-text("Save meal")');
  await page.waitForTimeout(500);
  await page.click('button.tab:has-text("History")');
  await page.waitForTimeout(300);
  check('history still says what it was at the time',
    (await page.locator('.hist-week').first().innerText()).indexOf('Butter Bean Traybake') !== -1, true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

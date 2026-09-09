// The grocery list on its own page, plus three fixes that came out of reading
// the code rather than using it: a tick that survives an item moving between
// the buy list and the cupboard, a copy that skips what you've already got in
// the trolley, and a new week that doesn't inherit last week's pantry guesses.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-gpage.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item, quantity, unit, section) => ({ item, quantity, unit, section: section||'other', pantryStaple:false, flag:null, substitute:'' });
const mk = (id, name, items) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings:4,
  method:'Cook.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients: items, macros:{ calories:'', protein:'', carbs:'', fat:'' }
});

const MEALS = [
  mk('m1','Traybake', [ing('garlic','2','cloves','produce'), ing('butter beans','2','tins','tins-and-dry-goods'), ing('lemon','1','','produce')]),
  mk('m2','Curry',    [ing('coconut milk','1','tin','tins-and-dry-goods')])
];
// A week carrying a stale pantry guess and a tick saved in the OLD key format.
const WEEK = {
  weekStart:'2026-01-05', mealIds:['m1','m2',null,null,null], started:true,
  checkedItems: { 'buy|produce|lemon': true },
  pantryMatches: { 'coconut milk': 'coconut milk' },
  pantryOverrides: { 'garlic': true },
  itemAliases: { 'garlic cloves': 'garlic' }
};

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}
const rowFor = (page, name) => page.locator('.g-item', { hasText: name }).first();

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  // Copy lands here instead of the real clipboard, which headless Chromium won't give us.
  await page.addInitScript(({ meals, week }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify([]));
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true
    });
    window.claude = { use: () => Promise.resolve(null) };
  }, { meals: MEALS, week: WEEK });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);

  // --- the list has its own tab, and the week page points at it ---
  check('a Grocery tab exists', await page.locator('button.tab:has-text("Grocery")').count(), 1);
  // coconut milk carries a stale pantry match in the seed week, so 4 items but 3 to buy
  check('the tab carries the count of things to buy',
    await page.locator('button.tab:has-text("Grocery")').innerText(), 'Grocery (3)');
  check('the week page shows a link, not the list', await page.locator('.g-item').count(), 0);
  await page.click('button:has-text("Open the list")');
  await page.waitForTimeout(300);
  check('the link opens the grocery tab', await page.locator('button.tab.active').innerText(), 'Grocery (3)');
  check('the list is on it', await page.locator('.g-item').count(), 4);

  // --- a tick saved in the old key format is still honoured ---
  check('a tick from the previous key format still reads as ticked',
    await rowFor(page,'lemon').locator('input[type="checkbox"]').isChecked(), true);

  // --- and a tick survives the item moving lists ---
  await rowFor(page,'butter beans').locator('input[type="checkbox"]').check();
  await page.waitForTimeout(300);
  await rowFor(page,'butter beans').locator('button:has-text("I already have this")').click();
  await page.waitForTimeout(400);
  const beans = rowFor(page,'butter beans');
  check('the item moved to the cupboard list', await beans.locator('.chip.in-pantry').count(), 1);
  check('and kept the tick it already had', await beans.locator('input[type="checkbox"]').isChecked(), true);

  // --- copying leaves out what is already ticked ---
  await page.click('button:has-text("Copy buy list")');
  await page.waitForTimeout(400);
  const copied = await page.evaluate(() => window.__copied || '');
  check('copy includes an unticked item', copied.indexOf('garlic') !== -1, true);
  check('copy leaves out the ticked one', copied.indexOf('lemon') === -1, true);
  check('copy leaves out what moved to the cupboard', copied.indexOf('butter beans') === -1, true);

  // --- starting a new week drops last week's pantry guesses, keeps the vocabulary ---
  await page.click('button.tab:has-text("This Week")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Start a new week")');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Yes, start fresh")');
  await page.waitForTimeout(500);
  const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')));
  check('picks cleared', fresh.mealIds.filter(Boolean).length, 0);
  check('ticks cleared', Object.keys(fresh.checkedItems).length, 0);
  check('last week\'s AI pantry matches cleared', Object.keys(fresh.pantryMatches).length, 0);
  check('last week\'s overrides cleared', Object.keys(fresh.pantryOverrides).length, 0);
  check('but learned wording is kept', fresh.itemAliases['garlic cloves'], 'garlic');

  // --- with nothing planned, the page says so instead of rendering an empty shell ---
  await page.click('button.tab:has-text("Grocery")');
  await page.waitForTimeout(250);
  check('empty grocery page explains itself',
    (await page.locator('.empty-state').innerText()).toLowerCase().indexOf('nothing planned yet') !== -1, true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

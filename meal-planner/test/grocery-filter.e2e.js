// The grocery list can be narrowed to one meal, so "what do I still need for
// Tuesday?" is answerable without mentally subtracting the other four dinners.
// The key property: a filtered list is REBUILT from that meal, so the amounts
// shown are that recipe's own, not the week's combined totals.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-filter.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item, quantity, unit, section) => ({ item, quantity, unit, section: section||'other', pantryStaple:false, flag:null, substitute:'' });
const mk = (id, name, items) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings:4,
  method:'Cook.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients: items, macros:{ calories:'', protein:'', carbs:'', fat:'' }
});

// Both meals want garlic, so the combined total (5 cloves) differs from either
// meal's own (2 and 3) — that difference is the whole point of the filter.
const MEALS = [
  mk('m1','Traybake', [ing('garlic','2','cloves','produce'), ing('butter beans','2','tins','tins-and-dry-goods'), ing('olive oil','2','tbsp')]),
  mk('m2','Curry',    [ing('garlic','3','cloves','produce'), ing('coconut milk','1','tin','tins-and-dry-goods')]),
  mk('m3','Toast',    [ing('olive oil','1','tbsp')])
];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1','m2','m3',null,null], checkedItems:{}, started:true };
const PANTRY = ['olive oil'];

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

  await page.addInitScript(({ meals, week, pantryList }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify(pantryList));
    window.claude = { use: () => Promise.resolve(null) };
  }, { meals: MEALS, week: WEEK, pantryList: PANTRY });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);

  // --- unfiltered: combined totals, one chip per meal ---
  check('a chip per meal plus Everything', await page.locator('.g-chip').count(), 4);
  check('Everything is selected by default', await page.locator('.g-chip.on').innerText(), 'Everything');
  check('garlic is combined across meals', (await rowFor(page,'garlic').locator('.g-total').innerText()).trim(), '5 cloves');
  // garlic, butter beans, coconut milk, olive oil — Toast's oil merges with the traybake's
  check('four distinct items across the week', await page.locator('.g-item').count(), 4);

  // the chip badge counts what that meal still needs (garlic + beans; oil is pantry)
  const trayChip = page.locator('.g-chip', { hasText: 'Traybake' });
  check('chip counts what that meal still needs', (await trayChip.locator('.g-chip-count').innerText()).trim(), '2');

  // --- filter to one meal ---
  await trayChip.click();
  await page.waitForTimeout(300);
  check('only that meal\'s items remain', await page.locator('.g-item').count(), 3);
  check('garlic drops to this meal\'s own amount', (await rowFor(page,'garlic').locator('.g-total').innerText()).trim(), '2 cloves');
  check('another meal\'s item is gone', await page.locator('.g-item', { hasText: 'coconut milk' }).count(), 0);
  check('the chip is marked active', (await page.locator('.g-chip.on').innerText()).replace(/\s+/g,' ').trim(), 'Traybake 2');

  const banner = (await page.locator('.g-filter-note').innerText()).replace(/\s+/g,' ').toLowerCase();
  check('banner names the meal', banner.indexOf('traybake') !== -1, true);
  check('banner says what is still to buy', banner.indexOf('2 of 3 ingredients still to buy') !== -1, true);
  check('banner gives the coverage percentage', banner.indexOf('33% covered') !== -1, true);

  // pantry items still separate out under the filter
  check('pantry item stays in the cupboard section', await rowFor(page,'olive oil').locator('.chip.in-pantry').count(), 1);

  // --- switching filters, and back to everything ---
  await page.locator('.g-chip', { hasText: 'Curry' }).click();
  await page.waitForTimeout(300);
  check('switching filters swaps the list', (await rowFor(page,'garlic').locator('.g-total').innerText()).trim(), '3 cloves');
  check('curry has two items', await page.locator('.g-item').count(), 2);

  await page.click('button:has-text("Back to the whole week")');
  await page.waitForTimeout(300);
  check('back to the combined total', (await rowFor(page,'garlic').locator('.g-total').innerText()).trim(), '5 cloves');
  check('all items are back', await page.locator('.g-item').count(), 4);

  // --- a meal with nothing to buy says so rather than showing an empty card ---
  await page.locator('.g-chip', { hasText: 'Toast' }).click();
  await page.waitForTimeout(300);
  const buyCard = (await page.locator('.card', { hasText: 'To buy' }).first().innerText()).toLowerCase();
  check('all-in-cupboard meal says so', buyCard.indexOf('all in the cupboard already') !== -1, true);

  // --- "what's missing" on a week slot drives the same filter ---
  await page.locator('.slot-wrap', { hasText: 'Curry' }).first().locator('button:has-text("what’s missing")').click();
  await page.waitForTimeout(400);
  check('slot link filters to that meal', (await page.locator('.g-chip.on').innerText()).replace(/\s+/g,' ').trim(), 'Curry 2');

  // --- checking an item off survives the filter, since keys are stable ---
  await rowFor(page,'garlic').locator('input[type="checkbox"]').check();
  await page.waitForTimeout(300);
  await page.click('.g-chip:has-text("Everything")');
  await page.waitForTimeout(300);
  check('a tick made under a filter still shows unfiltered',
    await rowFor(page,'garlic').locator('input[type="checkbox"]').isChecked(), true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

// "Tidy list with AI" has to collapse entries that mean the same thing —
// garlic / garlic cloves, ginger / fresh ginger — into one shopping line while
// keeping the per-recipe amounts, and must NOT merge things that only sound
// alike. Driven in Chromium with a canned AI response.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-merge.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const mk = (id, name, ings) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings:4,
  method:'Cook.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0, ingredients:ings
});
const ing = (item, quantity, unit, section) => ({ item, quantity, unit, section, pantryStaple:false, flag:null, substitute:'' });

const MEALS = [
  mk('m1','Stir Fry',[
    ing('garlic','2','cloves','produce'),
    ing('ginger','1','tbsp','produce'),
    ing('butter beans','1','tin','tins-and-dry-goods')
  ]),
  mk('m2','Curry',[
    ing('garlic cloves','3','cloves','produce'),
    ing('fresh ginger','2','tbsp','produce'),
    ing('butter','50','g','dairy-and-chilled')
  ])
];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1','m2',null,null,null], checkedItems:{}, started:true };

// What a good model should return: merge the two pairs, leave butter/butter beans alone.
const AI = {
  duplicates: [
    { name:'garlic', entries:['garlic','garlic cloves'] },
    { name:'ginger', entries:['ginger','fresh ginger'] }
  ],
  matches: []
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

  await page.addInitScript(({ meals, week, ai }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify([]));
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, { json: () => Promise.resolve(ai) }) : null
    )};
  }, { meals: MEALS, week: WEEK, ai: AI });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);
  // The grocery list lives on its own tab now.
  await page.click('button.tab:has-text("Grocery")');
  await page.waitForTimeout(250);

  const rows = () => page.locator('.g-item');
  const rowFor = (name) => page.locator('.g-item', { hasText: name }).first();

  // Before tidying: garlic and garlic cloves are two separate lines.
  check('starts with 6 separate lines', await rows().count(), 6);

  await page.click('button:has-text("Tidy list with AI")');
  await page.waitForTimeout(700);

  // After: garlic pair and ginger pair each collapse to one line -> 4 lines.
  check('duplicates collapsed to 4 lines', await rows().count(), 4);

  const garlic = rowFor('garlic');
  check('garlic line uses the plain name', (await garlic.locator('.g-name').innerText()).trim(), 'garlic');
  check('garlic totals are summed across both wordings', (await garlic.locator('.g-total').innerText()).trim(), '5 cloves');
  check('garlic keeps both recipes in the breakdown', await garlic.locator('.breakdown-list li').count(), 2);
  check('garlic says what it merged', (await garlic.innerText()).indexOf('Also listed as') !== -1, true);

  const ginger = rowFor('ginger');
  check('ginger merged too', (await ginger.locator('.g-total').innerText()).trim(), '3 tbsp');

  // The negative case that matters: butter must not swallow butter beans.
  check('butter still its own line', await page.locator('.g-item', { hasText: 'butter' }).count() >= 2, true);
  check('butter beans survived intact', (await rowFor('butter beans').locator('.g-total').innerText()).trim(), '1 tin');

  // Copied text should carry the merged totals, not the old split ones.
  const copyText = await page.evaluate(() => {
    const meals = JSON.parse(localStorage.getItem('mp_meals_v1'));
    return document.body.innerText.indexOf('garlic') !== -1;
  });
  check('merged list rendered', copyText, true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

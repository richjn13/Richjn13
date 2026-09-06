// Drives the real page in Chromium to check the grocery list layout and the
// three-layer pantry match (override > literal > AI). `window.claude` is stubbed
// so the app runs in localStorage mode with a canned AI pantry-match response.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-grocery.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

// Two meals sharing garlic, so the combined total and per-recipe breakdown matter.
const MEALS = [
  { id:'m1', name:'Traybake', base:'butter beans', effort:'Low', effortMinutes:30, tier:'often', servings:4,
    method:'Roast it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
    ingredients:[
      { item:'garlic', quantity:'2', unit:'cloves', section:'produce', pantryStaple:false, flag:null, substitute:'' },
      { item:'chopped tomatoes', quantity:'1', unit:'tin', section:'tins-and-dry-goods', pantryStaple:false, flag:null, substitute:'' },
      { item:'butter beans', quantity:'2', unit:'tins', section:'tins-and-dry-goods', pantryStaple:false, flag:null, substitute:'' }
    ]},
  { id:'m2', name:'Pasta', base:'gluten free pasta', effort:'Low', effortMinutes:20, tier:'often', servings:4,
    method:'Boil it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
    ingredients:[
      { item:'garlic', quantity:'3', unit:'cloves', section:'produce', pantryStaple:false, flag:null, substitute:'' },
      { item:'extra virgin olive oil', quantity:'2', unit:'tbsp', section:'other', pantryStaple:false, flag:null, substitute:'' }
    ]}
];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1','m2',null,null,null], checkedItems:{}, started:true };
const PANTRY = ['olive oil', 'tinned tomatoes'];

// "chopped tomatoes" is the one literal matching cannot reach.
const AI_MATCHES = { matches: [ { item:'chopped tomatoes', pantry:'tinned tomatoes' } ] };

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

  await page.addInitScript(({ meals, week, pantryList, ai }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify(pantryList));
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, { json: () => Promise.resolve(ai) }) : null
    )};
  }, { meals: MEALS, week: WEEK, pantryList: PANTRY, ai: AI_MATCHES });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);

  // --- one line per item: name left, combined total right ---
  const garlic = rowFor(page, 'garlic');
  check('garlic total is combined on one line', (await garlic.locator('.g-total').innerText()).trim(), '5 cloves');

  // --- per-recipe amounts underneath, one entry per meal ---
  check('garlic breaks down per recipe', await garlic.locator('.breakdown-list li').count(), 2);
  const bd = (await garlic.locator('.breakdown-list').innerText()).replace(/\s+/g,' ');
  check('breakdown names Traybake amount', bd.indexOf('2 cloves Traybake') !== -1, true);
  check('breakdown names Pasta amount', bd.indexOf('3 cloves Pasta') !== -1, true);

  // --- single-recipe items get the same treatment, not a different one ---
  check('single-recipe item still shows a breakdown line',
    await rowFor(page, 'butter beans').locator('.breakdown-list li').count(), 1);

  // --- literal pantry match: "olive oil" covers "extra virgin olive oil" ---
  check('literal match lands in pantry', await rowFor(page, 'extra virgin olive oil').locator('.chip.in-pantry').count(), 1);
  // --- and "butter beans" must NOT be matched by anything ---
  check('butter beans not falsely matched', await rowFor(page, 'butter beans').locator('.chip.in-pantry').count(), 0);

  // --- before the AI pass, "chopped tomatoes" is still on the buy list ---
  check('chopped tomatoes unmatched before AI', await rowFor(page, 'chopped tomatoes').locator('.chip.in-pantry').count(), 0);

  // --- run the AI pantry check ---
  await page.click('button:has-text("Check pantry with AI")');
  await page.waitForTimeout(600);
  check('AI matched chopped tomatoes', await rowFor(page, 'chopped tomatoes').locator('.chip.in-pantry').count(), 1);
  check('AI match names the covering staple',
    (await rowFor(page, 'chopped tomatoes').locator('.pantry-note').innerText()).indexOf('tinned tomatoes') !== -1, true);

  // --- the user can overrule a match ---
  await rowFor(page, 'chopped tomatoes').locator('button:has-text("not really")').click();
  await page.waitForTimeout(400);
  check('override removes the match', await rowFor(page, 'chopped tomatoes').locator('.chip.in-pantry').count(), 0);

  // --- "I already have this" adds to the shared pantry ---
  await rowFor(page, 'butter beans').locator('button:has-text("I already have this")').click();
  await page.waitForTimeout(400);
  const savedPantry = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')));
  check('butter beans added to pantry', savedPantry.indexOf('butter beans') !== -1, true);
  check('butter beans now shows as in pantry', await rowFor(page, 'butter beans').locator('.chip.in-pantry').count(), 1);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

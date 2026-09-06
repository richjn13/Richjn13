// Drives the real page in Chromium. window.claude is stubbed so the app runs in
// its localStorage mode with a fake `sample` that returns a known adjustment —
// which is exactly the path the user reported as broken.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable.html';

// The artifact host wraps the fragment; reproduce that so it loads from file://.
const body = fs.readFileSync(SRC, 'utf8');
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${body}\n</body></html>`);

const SEED_MEAL = {
  id: 'm1', name: 'Butter Bean Traybake', base: 'butter beans',
  effort: 'Low, 30 min', effortMinutes: 30, tier: 'often', servings: 4,
  method: '1. Melt the butter in a pan.\n2. Add the butter beans and roast.',
  notes: '', sourceUrl: '',
  dietFlags: [],
  ingredients: [
    { item:'butter', quantity:'2', unit:'tbsp', section:'dairy-and-chilled', pantryStaple:false, flag:null, substitute:'' },
    { item:'butter beans', quantity:'2', unit:'tins', section:'tins-and-dry-goods', pantryStaple:false, flag:null, substitute:'' },
    { item:'thyme', quantity:'1', unit:'tsp', section:'produce', pantryStaple:false, flag:null, substitute:'' }
  ],
  lastCooked: '', timesCooked: 0
};

const ADJUSTED = {
  base: 'butter beans',
  method: '1. Heat the olive oil in a pan.\n2. Add the butter beans and roast.',
  notes: 'Swapped butter for olive oil.',
  dietFlags: [],
  ingredients: [
    { item:'olive oil', quantity:'2', unit:'tbsp', section:'other', pantryStaple:false, flag:null, substitute:'' },
    { item:'butter beans', quantity:'2', unit:'tins', section:'tins-and-dry-goods', pantryStaple:false, flag:null, substitute:'' },
    { item:'thyme', quantity:'1', unit:'tsp', section:'produce', pantryStaple:false, flag:null, substitute:'' }
  ]
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

  await page.addInitScript(({ meal, adjusted }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify([meal]));
    window.claude = {
      use: (name) => Promise.resolve(
        name === 'sample'
          ? Object.assign(function(){ return Promise.resolve({ text:'' }); }, {
              json: () => Promise.resolve(adjusted)
            })
          : null
      )
    };
  }, { meal: SEED_MEAL, adjusted: ADJUSTED });

  await page.goto('file://' + OUT);
  await page.waitForTimeout(400);

  // --- Meals tab ---
  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(150);
  check('meal row is listed', await page.locator('.m-name-btn').first().innerText(), 'Butter Bean Traybake');

  // --- open the edit form ---
  await page.click('button:has-text("Edit")');
  await page.waitForTimeout(200);
  check('form opened with method', await page.inputValue('#f-method'), SEED_MEAL.method);

  // --- 1. clicking a plain field must NOT close/save the form (the old killer) ---
  await page.click('#f-notes');
  await page.waitForTimeout(150);
  check('form still open after clicking notes', await page.locator('#form-overlay').count(), 1);
  await page.fill('#f-notes', 'typed by hand');
  check('typing into notes sticks', await page.inputValue('#f-notes'), 'typed by hand');

  // --- 2. THE REPORTED BUG: AI adjust must rewrite the method textarea ---
  await page.fill('#adjust-instruction', 'replace the butter with olive oil');
  await page.click('button:has-text("Apply")');
  await page.waitForTimeout(400);
  check('AI adjust updates the METHOD', await page.inputValue('#f-method'), ADJUSTED.method);
  check('AI adjust updates ingredient 1', await page.locator('.sub-row [data-field="item"]').first().inputValue(), 'olive oil');
  const notesAfter = await page.inputValue('#f-notes');
  check('hand-typed note survives the adjust', notesAfter.indexOf('typed by hand') !== -1, true);
  check('AI note appended alongside it', notesAfter.indexOf('Swapped butter') !== -1, true);

  // --- 3. same mechanism: removing an ingredient row must stay removed ---
  const before = await page.locator('.sub-row').count();
  await page.locator('.sub-row button:has-text("remove")').first().click();
  await page.waitForTimeout(200);
  check('ingredient row stays removed', await page.locator('.sub-row').count(), before - 1);

  // --- 4. same mechanism: Mark cooked today must apply ---
  await page.click('button:has-text("Mark cooked today")');
  await page.waitForTimeout(200);
  const d = new Date();
  const today = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  check('Mark cooked sets last cooked', await page.inputValue('#f-lastCooked'), today);
  check('Mark cooked increments count', await page.inputValue('#f-timesCooked'), '1');

  // --- 5. save persists ---
  await page.click('button:has-text("Save meal")');
  await page.waitForTimeout(400);
  check('form closed after save', await page.locator('#form-overlay').count(), 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1'))[0]);
  check('saved method is the adjusted one', saved.method, ADJUSTED.method);
  check('saved notes kept hand edit', saved.notes.indexOf('typed by hand') !== -1, true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

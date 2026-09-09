// The rebuilt pantry: structured items on shelves, a running-low flag, and the
// two AI features. The load-bearing checks are the safety ones — an AI add must
// never invent an item nobody typed, and the old plain-string format must still
// read, because that's what every existing household has saved.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-pantry.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item) => ({ item, quantity:'1', unit:'', section:'other', pantryStaple:false, flag:null, substitute:'' });
const mk = (id, name, items) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings:4,
  method:'1. Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients: items.map(ing), macros:{ calories:'', protein:'', carbs:'', fat:'' }
});
const MEALS = [ mk('m1','Traybake',['butter beans','lemon']), mk('m2','Curry',['chickpeas','coconut milk']) ];

// Deliberately the OLD format: a flat array of strings, as saved by every
// version of the app before this one.
const LEGACY_PANTRY = ['olive oil', 'tinned tomatoes', 'butter beans'];

// What a well-behaved model returns for "toms, rice and we're nearly out of oil".
const SORT_REPLY = { items: [
  { name:'tinned tomatoes', section:'tins-and-dry-goods', low:false },
  { name:'basmati rice',    section:'tins-and-dry-goods', low:false },
  { name:'olive oil',       section:'other',              low:true  },
  { name:'onions',          section:'produce',            low:false }  // never typed — must be dropped
]};

const IDEAS_REPLY = {
  readyNow: [ { name:'Traybake', note:'Everything for it is in the house.' } ],
  almost:   [ { name:'Curry', missing:['coconut milk'] } ],
  ideas:    [ { name:'Tomato Rice', uses:'tinned tomatoes, basmati rice', note:'One pan, twenty minutes.' } ]
};

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}

async function boot(page, reply){
  await page.addInitScript(({ meals, pantryList, ai }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify({ weekStart:'2026-01-05', mealIds:[null,null,null,null,null], checkedItems:{}, started:true }));
    localStorage.setItem('mp_pantry_v1', JSON.stringify(pantryList));
    localStorage.setItem('mp_history_v1', '[]');
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, { json: () => Promise.resolve(ai) }) : null
    )};
  }, { meals: MEALS, pantryList: LEGACY_PANTRY, ai: reply });
  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);
  await page.click('button.tab:has-text("Pantry")');
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ---------------------------------------------------------------- add & sort
  let page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, SORT_REPLY);

  // Old plain strings still load.
  check('legacy string pantry still reads', await page.locator('.pantry-item').count(), 3);
  check('and lands on a shelf', await page.locator('.g-section').count() >= 1, true);

  // Coverage elsewhere must keep working off the new shape.
  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(250);
  // Traybake needs butter beans + lemon; the pantry covers the beans -> 50%.
  check('coverage still computed from the pantry',
    (await page.locator('.meal-row', { hasText: 'Traybake' }).first().locator('.cover-text').innerText()).indexOf('50%') !== -1, true);
  await page.click('button.tab:has-text("Pantry")');
  await page.waitForTimeout(250);

  await page.fill('#pantry-input', 'toms, rice and we are nearly out of oil');
  await page.click('button:has-text("Add & sort")');
  await page.waitForTimeout(700);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')));
  const names = saved.map(p => p.name);
  check('items are objects now, not strings', typeof saved[0], 'object');
  check('a new item was filed', names.indexOf('basmati rice') !== -1, true);
  check('on the shelf the model chose',
    saved.find(p => p.name === 'basmati rice').section, 'tins-and-dry-goods');
  check('an item already on the list is not duplicated',
    names.filter(n => n === 'tinned tomatoes').length, 1);
  check('AN INVENTED ITEM IS DROPPED', names.indexOf('onions'), -1);
  // "we are nearly out of oil" is about an item already on the list — the flag
  // has to land on it rather than being skipped as a duplicate.
  check('an existing item can be flagged low by the same add',
    saved.find(p => p.name === 'olive oil').low, true);
  check('and the drop is reported',
    (await page.locator('.warnbox.info').innerText()).indexOf('didn’t match what you typed') !== -1, true);

  // ------------------------------------------------------------- running low
  await page.locator('.pantry-item', { hasText: 'butter beans' }).locator('.pantry-name').click();
  await page.waitForTimeout(400);
  check('tapping a name flags it low',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')).find(p => p.name === 'butter beans').low), true);
  check('the chip shows it', await page.locator('.pantry-item.low').count() >= 1, true);
  check('and a banner collects them',
    (await page.locator('.warnbox.warn').innerText()).toLowerCase().indexOf('running low') !== -1, true);
  // Low is not gone: it still covers the grocery list.
  // 3 legacy + basmati rice; the tomatoes and oil were already there, onions dropped.
  check('a low item still counts as in the house',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')).length), 4);

  await page.locator('.pantry-item', { hasText: 'butter beans' }).locator('.pantry-name').click();
  await page.waitForTimeout(400);
  check('tapping again clears it',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')).find(p => p.name === 'butter beans').low), false);

  // ------------------------------------------------------------------ remove
  await page.locator('.pantry-item', { hasText: 'basmati rice' }).locator('.pantry-remove').click();
  await page.waitForTimeout(400);
  check('remove takes it off',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')).some(p => p.name === 'basmati rice')), false);

  // --- "Add plain" still works without touching the model ---
  await page.fill('#pantry-input', 'sea salt, black pepper');
  await page.click('button:has-text("Add plain")');
  await page.waitForTimeout(500);
  check('plain add takes them as typed',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1')).some(p => p.name === 'sea salt')), true);
  await page.close();

  // ---------------------------------------------------------- what can we make
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, IDEAS_REPLY);

  await page.click('button:has-text("What can we make?")');
  await page.waitForTimeout(700);
  const panel = page.locator('.card', { hasText: 'What you could make' }).first();
  const text = (await panel.innerText()).replace(/\s+/g,' ');
  check('a ready-now meal is named', text.indexOf('Traybake') !== -1, true);
  check('an almost-there meal says what is missing', text.indexOf('Needs coconut milk') !== -1, true);
  check('a fresh idea is offered', text.indexOf('Tomato Rice') !== -1, true);
  check('and says what it would use up', text.indexOf('tinned tomatoes, basmati rice') !== -1, true);
  check('it admits it is not a stock take', text.toLowerCase().indexOf('suggestions, not a stock take') !== -1, true);

  // A ready-now meal that exists can be cooked straight from here.
  check('ready-now offers to cook it', await panel.locator('button:has-text("Cook it")').count(), 1);
  await panel.locator('button:has-text("Cook it")').click();
  await page.waitForTimeout(400);
  check('and cook mode opens on the right meal',
    (await page.locator('.cook-name').innerText()).trim(), 'Traybake');
  await page.click('.close-x');
  await page.waitForTimeout(300);

  // An idea becomes a draft meal, clearly labelled as not-a-recipe.
  await page.click('button:has-text("Add it to Meals")');
  await page.waitForTimeout(400);
  check('the meal form opens', await page.locator('#form-overlay').count(), 1);
  check('with the idea\'s name', await page.inputValue('#f-name'), 'Tomato Rice');
  const notes = await page.inputValue('#f-notes');
  check('and a warning that it is not a recipe yet', notes.indexOf('NOTHING HERE IS A REAL RECIPE YET') !== -1, true);
  check('saying what it was meant to use up', notes.indexOf('tinned tomatoes') !== -1, true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

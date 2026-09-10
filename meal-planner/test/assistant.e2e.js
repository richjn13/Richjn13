// The assistant. The load-bearing property is that it PROPOSES and never
// writes: every action is validated against real records, shown as a readable
// change, and only applied on Apply. An action naming a meal that doesn't
// exist must be dropped rather than guessed at, and a question must suppress
// changes entirely — it either knows what you meant or it doesn't.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-asst.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item, quantity, unit) => ({ item, quantity, unit, section:'other', pantryStaple:false, flag:null, substitute:'' });
const MEALS = [
  { id:'m1', name:'Butter Bean Traybake', base:'butter beans', effort:'Low', effortMinutes:30, tier:'often',
    servings:4, method:'1. Melt the butter.\n2. Roast the beans.', notes:'', sourceUrl:'', dietFlags:[],
    lastCooked:'', timesCooked:0, ingredients:[ing('butter','20','g'), ing('butter beans','2','tins')],
    macros:{calories:'',protein:'',carbs:'',fat:''} },
  { id:'m2', name:'Coconut Chickpea Curry', base:'chickpeas', effort:'Low', effortMinutes:20, tier:'often',
    servings:4, method:'1. Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
    ingredients:[ing('chickpeas','1','tin')], macros:{calories:'',protein:'',carbs:'',fat:''} }
];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1',null,null,null,null], checkedItems:{}, started:true };
const PANTRY = [{ name:'basmati rice', section:'tins-and-dry-goods', low:false }];

// A good reply: swap an ingredient AND rewrite the method to match.
const SWAP = {
  reply: 'Swapping the butter for olive oil, and rewriting step 1 so it matches.',
  actions: [
    { type:'updateIngredient', mealId:'m1', item:'butter', newItem:'olive oil', quantity:'2', unit:'tbsp' },
    { type:'updateMeal', mealId:'m1', changes:{ method:'1. Heat the olive oil.\n2. Roast the beans.' } }
  ]
};

// Ambiguous: a question and no actions.
const ASK = {
  reply: 'Two of your meals have beans in them.',
  question: 'Which one did you mean?',
  options: ['Butter Bean Traybake', 'Coconut Chickpea Curry'],
  actions: []
};

// A question AND actions at once — the question must win.
const ASK_BUT_ACTS = {
  reply: 'I think you mean the traybake.',
  question: 'Is it the traybake you mean?',
  actions: [{ type:'removeIngredient', mealId:'m1', item:'butter' }]
};

// Half of these name things that don't exist and must be dropped.
const JUNK = {
  reply: 'Adding those.',
  actions: [
    { type:'addBuyItem', item:'bin bags', quantity:'1', unit:'box' },
    { type:'removeIngredient', mealId:'m9', item:'anything' },
    { type:'updateMeal', mealId:'m1', changes:{ tier:'not-a-real-tier' } },
    { type:'setPantryLow', name:'saffron', low:true },
    { type:'launchMissiles', target:'everything' }
  ]
};

const PANTRY_ACTS = {
  reply: 'Marking the rice low and putting it on the list.',
  actions: [
    { type:'setPantryLow', name:'basmati rice', low:true },
    { type:'addBuyItem', item:'basmati rice', quantity:'1', unit:'bag', section:'tins-and-dry-goods' }
  ]
};

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}

async function boot(page, reply){
  await page.addInitScript(({ meals, week, pantryList, ai }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', JSON.stringify(pantryList));
    localStorage.setItem('mp_history_v1', '[]');
    window.__prompts = [];
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, {
        json: (p) => { window.__prompts.push(p); return Promise.resolve(ai); }
      }) : null
    )};
  }, { meals: MEALS, week: WEEK, pantryList: PANTRY, ai: reply });
  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);
}

async function ask(page, text){
  await page.click('.asst-bubble');
  await page.waitForTimeout(250);
  await page.fill('#asst-input', text);
  await page.click('.asst-foot button[type="submit"]');
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // --------------------------------------------------- propose, confirm, apply
  let page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, SWAP);

  check('the bubble is there', await page.locator('.asst-bubble').count(), 1);
  check('"What can we make?" is gone',
    await page.locator('button:has-text("What can we make?")').count(), 0);

  await ask(page, 'swap the butter in the traybake for olive oil');

  // Nothing may have been written yet.
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm1'));
  check('NOTHING is written before you confirm', before.ingredients[0].item, 'butter');
  check('the method is untouched too', before.method.indexOf('Melt the butter') !== -1, true);

  check('both changes are offered', await page.locator('.asst-change').count(), 2);
  const pending = (await page.locator('.asst-pending').innerText()).replace(/\s+/g, ' ');
  check('the ingredient change is spelled out', pending.indexOf('butter') !== -1 && pending.indexOf('olive oil') !== -1, true);
  // .asst-tag is uppercased in CSS, so innerText shouts it back.
  check('a method rewrite shows the old text', pending.indexOf('Melt the butter') !== -1, true);
  check('and the whole new text', pending.indexOf('Heat the olive oil') !== -1, true);
  check('the composer is hidden while deciding', await page.locator('#asst-input').count(), 0);

  // The prompt must have carried the real state, including the method it edits.
  const prompt = await page.evaluate(() => window.__prompts[0]);
  check('the prompt carries the meal id', prompt.indexOf('id=m1') !== -1, true);
  check('and the method of the week\'s meal', prompt.indexOf('Melt the butter') !== -1, true);
  check('and the pantry', prompt.indexOf('basmati rice') !== -1, true);

  // Untick one and only the other applies.
  await page.locator('.asst-change').nth(1).locator('input[type="checkbox"]').uncheck();
  await page.waitForTimeout(300);
  check('the button counts what is ticked',
    (await page.locator('button:has-text("Apply")').innerText()).indexOf('Apply 1 change') !== -1, true);

  await page.click('button:has-text("Apply 1 change")');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm1'));
  check('the ticked change applied', after.ingredients[0].item, 'olive oil');
  check('and carried the new quantity', after.ingredients[0].quantity, '2');
  check('the unticked one did NOT', after.method.indexOf('Melt the butter') !== -1, true);
  check('the panel confirms what happened',
    (await page.locator('.asst-msg.from-ai').last().innerText()).indexOf('1 change applied') !== -1, true);
  await page.close();

  // ------------------------------------------------------------ discard
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, SWAP);
  await ask(page, 'swap the butter for oil');
  await page.click('button:has-text("Discard")');
  await page.waitForTimeout(500);
  check('discard writes nothing',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).find(m => m.id === 'm1').ingredients[0].item), 'butter');
  check('and says so', (await page.locator('.asst-msg.from-ai').last().innerText()).indexOf('Left everything as it was') !== -1, true);
  check('the composer is back', await page.locator('#asst-input').count(), 1);
  await page.close();

  // ------------------------------------------- ambiguity asks instead of acting
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, ASK);
  await ask(page, 'take the beans out');
  check('it asks rather than guessing', await page.locator('.asst-question').count(), 1);
  check('no changes are offered', await page.locator('.asst-pending').count(), 0);
  check('with tappable answers', await page.locator('.asst-options .g-chip').count(), 2);
  await page.close();

  // A question alongside actions is a contradiction; the question wins.
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, ASK_BUT_ACTS);
  await ask(page, 'remove the butter');
  check('a question suppresses the changes', await page.locator('.asst-pending').count(), 0);
  check('the question still shows', await page.locator('.asst-question').count(), 1);
  await page.close();

  // ------------------------------------------ nonsense actions are dropped
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, JUNK);
  await ask(page, 'add bin bags and some other stuff');
  check('only the valid action survives', await page.locator('.asst-change').count(), 1);
  check('and it is the right one',
    (await page.locator('.asst-change').innerText()).indexOf('buy list') !== -1, true);
  check('the drops are reported',
    (await page.locator('.asst-pending').innerText()).indexOf('didn’t match anything') !== -1, true);
  await page.close();

  // ------------------------------------- pantry and buy list in one go
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, PANTRY_ACTS);
  await ask(page, 'we are nearly out of rice, put it on the list');
  check('two changes offered', await page.locator('.asst-change').count(), 2);
  await page.click('button:has-text("Apply 2 changes")');
  await page.waitForTimeout(1000);
  check('the pantry item is flagged low',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_pantry_v1'))[0].low), true);
  const wk = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')));
  check('and it landed on the buy list', wk.extraItems[0].item, 'basmati rice');

  // The one-off item shows on the grocery page and can be taken off again.
  await page.click('.close-x');
  await page.waitForTimeout(200);
  await page.click('button.tab:has-text("Grocery")');
  await page.waitForTimeout(400);
  const row = page.locator('.g-item', { hasText: 'basmati rice' }).first();
  check('the extra item is on the grocery list', await row.count(), 1);
  check('marked as added by hand', (await row.innerText()).indexOf('Added by hand') !== -1, true);
  await row.locator('button:has-text("take it off")').click();
  await page.waitForTimeout(500);
  check('and can be taken off',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).extraItems.length), 0);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

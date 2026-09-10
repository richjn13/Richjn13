// The week is any size from 1 to 10, not always five. The interesting cases are
// at the edges and on the way down: shrinking past a slot that holds a meal has
// to say which pick it would lose before it loses it.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-weeksize.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const ing = (item) => ({ item, quantity:'1', unit:'', section:'other', pantryStaple:false, flag:null, substitute:'' });
const mk = (id, name) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings:4,
  method:'1. Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients:[ing(name.toLowerCase() + ' thing')], macros:{calories:'',protein:'',carbs:'',fat:''}
});
const MEALS = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet','Kilo']
  .map((n, i) => mk('m' + (i+1), n));

const WEEK = { weekStart:'2026-01-05', mealIds:['m1','m2','m3','m4','m5'], slots:5, checkedItems:{}, started:true };

const AI_RESIZE = { reply: 'Setting the week to three dinners.', actions: [{ type:'setWeekSlots', slots: 3 }] };

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}

async function boot(page, week, ai){
  await page.addInitScript(({ meals, wk, reply }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(wk));
    localStorage.setItem('mp_pantry_v1', '[]');
    localStorage.setItem('mp_history_v1', '[]');
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, { json: () => Promise.resolve(reply) }) : null
    )};
  }, { meals: MEALS, wk: week, reply: ai || {} });
  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);
}
const slots = (page) => page.locator('.slots .slot').count();
const stepUp = (page) => page.locator('.step-btn').nth(1).click();
const stepDown = (page) => page.locator('.step-btn').nth(0).click();

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ------------------------------------------------------- growing is free
  let page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, WEEK);

  check('starts at five slots', await slots(page), 5);
  check('the heading says five', (await page.locator('.section-head h2').first().innerText()).indexOf('5') !== -1, true);
  check('and the note counts the spare nights',
    (await page.locator('.loose-note').innerText()).indexOf('two nights open') !== -1, true);

  await stepUp(page);
  await page.waitForTimeout(500);
  check('one more slot appears', await slots(page), 6);
  check('the picks are untouched',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).mealIds.filter(Boolean).length), 5);
  check('the size is stored', await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).slots), 6);
  check('the spare-nights line follows',
    (await page.locator('.loose-note').innerText()).indexOf('one night open') !== -1, true);

  // Seven is the whole week; past that the copy has to stop claiming spare nights.
  for (let i = 0; i < 1; i++) { await stepUp(page); await page.waitForTimeout(400); }
  check('seven dinners is every night',
    (await page.locator('.loose-note').innerText()).toLowerCase().indexOf('every night of the week') !== -1, true);
  await stepUp(page); await page.waitForTimeout(400);
  check('past seven it says so, rather than inventing nights',
    (await page.locator('.loose-note').innerText()).indexOf('more than a week') !== -1, true);

  // The ceiling holds — step until the button refuses rather than counting.
  for (let i = 0; i < 6 && !(await page.locator('.step-btn').nth(1).isDisabled()); i++) {
    await stepUp(page); await page.waitForTimeout(350);
  }
  check('stops at ten', await slots(page), 10);
  check('and the + is disabled there',
    await page.locator('.step-btn').nth(1).isDisabled(), true);
  await page.close();

  // ------------------------------------- shrinking past a pick asks first
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, WEEK);

  await stepDown(page);
  await page.waitForTimeout(400);
  check('it warns before dropping a pick', await page.locator('.slot-confirm').count(), 1);
  const warn = (await page.locator('.slot-confirm').innerText()).replace(/\s+/g,' ');
  check('and names the meal it would lose', warn.indexOf('Echo') !== -1, true);
  check('nothing changed yet', await slots(page), 5);
  check('and nothing was written',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).slots), 5);

  await page.click('button:has-text("Cancel")');
  await page.waitForTimeout(300);
  check('cancel leaves it alone', await slots(page), 5);

  await stepDown(page);
  await page.waitForTimeout(400);
  await page.click('button:has-text("Yes, drop it")');
  await page.waitForTimeout(600);
  check('confirming shrinks it', await slots(page), 4);
  const wk = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')));
  check('the dropped pick is gone from the week', wk.mealIds.indexOf('m5'), -1);
  check('but the meal itself survives',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).some(m => m.id === 'm5')), true);
  await page.close();

  // ------------------------------- shrinking over empty slots doesn't ask
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, { weekStart:'2026-01-05', mealIds:['m1','m2',null,null,null], slots:5, checkedItems:{}, started:true });
  await stepDown(page);
  await page.waitForTimeout(500);
  check('dropping an empty slot is silent', await page.locator('.slot-confirm').count(), 0);
  check('and just happens', await slots(page), 4);
  await page.close();

  // -------------------------------------------------- one meal is a valid week
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, { weekStart:'2026-01-05', mealIds:['m1'], slots:1, checkedItems:{}, started:true });
  check('a one-dinner week renders one slot', await slots(page), 1);
  check('the − is disabled at the floor', await page.locator('.step-btn').nth(0).isDisabled(), true);
  check('and the copy reads properly',
    (await page.locator('.loose-note').innerText()).indexOf('other six nights') !== -1, true);
  check('the warnings do not demand five',
    (await page.locator('body').innerText()).indexOf('of 5 picked'), -1);

  // Auto-pick fills exactly the week, no more.
  await page.click('button:has-text("Auto-pick")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Yes, auto-pick")');
  await page.waitForTimeout(600);
  check('auto-pick fills one slot only',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).mealIds.filter(Boolean).length), 1);
  await page.close();

  // ------------------------------------- ten, and a new week keeps the size
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, { weekStart:'2026-01-05', mealIds:['m1','m2'], slots:10, checkedItems:{}, started:true });
  check('a ten-dinner week renders ten slots', await slots(page), 10);
  await page.click('button:has-text("Auto-pick")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Yes, auto-pick")');
  await page.waitForTimeout(700);
  check('auto-pick fills all ten',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).mealIds.filter(Boolean).length), 10);

  await page.click('button:has-text("Start a new week")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Yes, start fresh")');
  await page.waitForTimeout(800);
  check('a new week keeps the chosen size',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).slots), 10);
  check('with everything cleared',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).mealIds.filter(Boolean).length), 0);
  check('and the old week was filed',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_history_v1')).length), 1);
  await page.close();

  // -------------------------------------- the assistant can resize it too
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, WEEK, AI_RESIZE);
  await page.click('.asst-bubble');
  await page.waitForTimeout(250);
  await page.fill('#asst-input', 'only three dinners this week please');
  await page.click('.asst-foot button[type="submit"]');
  await page.waitForTimeout(800);
  const card = (await page.locator('.asst-change').innerText()).replace(/\s+/g,' ');
  check('it proposes the resize', card.indexOf('3 dinners') !== -1, true);
  check('and warns what it would drop', card.indexOf('Delta') !== -1 && card.indexOf('Echo') !== -1, true);
  check('nothing applied yet', await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).slots), 5);
  await page.click('button:has-text("Apply 1 change")');
  await page.waitForTimeout(800);
  check('applying resizes the week',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_week_v1')).slots), 3);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

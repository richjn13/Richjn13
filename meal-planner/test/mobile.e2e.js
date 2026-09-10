// Phone regressions. These are the things that were actually wrong when the app
// was first driven at 390px rather than at desktop width, and they are the ones
// that make it unusable in a shop or a kitchen rather than merely untidy.
//
// It runs against dist/index.html on purpose — the built page carries the
// viewport meta. Without it a mobile browser lays out at 980px and every
// measurement here is meaningless.
const { chromium } = require('playwright-core');
const { execSync } = require('child_process');

execSync('node /home/user/Richjn13/meal-planner/build.mjs', { stdio: 'ignore' });
const PAGE = 'file:///home/user/Richjn13/meal-planner/dist/index.html';

const ing = (item, q, u, sec, flag) => ({ item, quantity:q, unit:u, section:sec||'other',
  pantryStaple:false, flag:flag||null, substitute: flag ? 'use a plant-based version' : '' });
const MEALS = [
  { id:'m1', name:'Butter Bean & Harissa Traybake with Preserved Lemon', base:'butter beans',
    effort:'Low, 30 min', effortMinutes:30, tier:'often', servings:4,
    method:'1. Heat the oven.\n2. Melt the butter and tip in the beans.\n3. Serve.',
    notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
    ingredients:[ing('butter beans','2','tins','tins-and-dry-goods'), ing('butter','20','g','dairy-and-chilled','cow-milk')],
    macros:{ calories:520, protein:24, carbs:48, fat:18 } },
  { id:'m2', name:'Coconut Chickpea Curry', base:'chickpeas', effort:'Low', effortMinutes:20, tier:'often',
    servings:4, method:'1. Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
    ingredients:[ing('coconut milk','1','tin','tins-and-dry-goods')], macros:{calories:'',protein:'',carbs:'',fat:''} }
];
const WEEK = { weekStart:'2026-09-07', mealIds:['m1','m2',null], slots:3, checkedItems:{},
  extraItems:[{ item:'bin bags', quantity:'1', unit:'box', section:'other' }], started:true };

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });

  await page.addInitScript(({ meals, week }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', '[]');
    localStorage.setItem('mp_history_v1', '[]');
    window.claude = { use: (n) => Promise.resolve(
      n === 'sample' ? Object.assign(function(){ return Promise.resolve({text:''}); }, { json: () => Promise.resolve({ reply:'ok', actions: [] }) }) : null
    )};
  }, { meals: MEALS, week: WEEK });

  await page.goto(PAGE);
  await page.waitForTimeout(600);

  // The whole test rests on this: without the viewport meta the browser lays
  // out at 980px and nothing below measures what a phone would see.
  check('the built page lays out at phone width', await page.evaluate(() => window.innerWidth), 390);

  // --- every tab reachable without a sideways swipe ---
  const tabs = await page.evaluate(() => {
    const bar = document.querySelector('.tabs');
    return { scrollW: bar.scrollWidth, clientW: bar.clientWidth, count: bar.children.length };
  });
  check('all six tabs are on screen', tabs.scrollW <= tabs.clientW + 1, true);
  check('and there are six', tabs.count, 6);

  // --- nothing scrolls sideways on any tab ---
  for (const tab of ['This Week','Grocery','Meals','History','Pantry','Import']){
    await page.click(`button.tab:has-text("${tab}")`);
    await page.waitForTimeout(350);
    const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    check(`${tab} does not scroll sideways`, o.doc <= o.win + 1, true);
  }

  // --- the grocery tick target is big enough to hit in a shop ---
  await page.click('button.tab:has-text("Grocery")');
  await page.waitForTimeout(400);
  const tick = await page.evaluate(() => {
    const el = document.querySelector('.g-tick');
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width) };
  });
  check('the tick row is a real target, not a 22px box', tick.h >= 44, true);
  check('and spans the row', tick.w > 250, true);

  // Tapping the row's text ticks it, not just the box itself.
  const row = page.locator('.g-item', { hasText: 'butter beans' }).first();
  await row.locator('.g-name').click();
  await page.waitForTimeout(400);
  check('tapping the name ticks the item', await row.locator('input[type=checkbox]').isChecked(), true);

  // Row actions sit outside the tick target, so they can't toggle it by accident.
  const actionsInside = await page.evaluate(() =>
    !!document.querySelector('.g-tick .have-it-btn') || !!document.querySelector('.g-tick [data-action="removeBuyItem"]'));
  check('row actions are outside the tick target', actionsInside, false);

  // --- an added-by-hand item says so once, not twice ---
  const bin = await page.locator('.g-item', { hasText: 'bin bags' }).first().innerText();
  check('"Added by hand" appears once', (bin.match(/Added by hand/g) || []).length, 1);

  // --- the floating bubble must not cover a modal's buttons ---
  check('the bubble is there normally', await page.locator('.asst-bubble').count(), 1);

  await page.click('button.tab:has-text("This Week")');
  await page.waitForTimeout(350);
  await page.locator('.slot-wrap').first().locator('button:has-text("Cook")').click();
  await page.waitForTimeout(400);
  check('the bubble is gone in cook mode', await page.locator('.asst-bubble').count(), 0);
  // and the footer buttons are actually on screen, not under the toolbar
  const foot = await page.evaluate(() => {
    const r = document.querySelector('.cook-foot').getBoundingClientRect();
    return { bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
  check('cook mode buttons sit inside the viewport', foot.bottom <= foot.vh + 1, true);
  await page.click('button:has-text("Start cooking")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(250);
  check('and Next is clickable, not intercepted',
    (await page.locator('.cook-progress').innerText()).toLowerCase().indexOf('step 2') !== -1, true);
  await page.click('.close-x');
  await page.waitForTimeout(300);

  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(350);
  await page.locator('.meal-row').first().locator('button:has-text("Edit")').click();
  await page.waitForTimeout(400);
  check('the bubble is gone in the meal form', await page.locator('.asst-bubble').count(), 0);
  await page.click('button:has-text("Cancel")');
  await page.waitForTimeout(300);

  await page.click('button.tab:has-text("This Week")');
  await page.waitForTimeout(350);
  await page.locator('.slot-empty-btn').first().click();
  await page.waitForTimeout(400);
  check('the bubble is gone in the week picker', await page.locator('.asst-bubble').count(), 0);
  await page.click('.close-x');
  await page.waitForTimeout(300);
  check('and it comes back afterwards', await page.locator('.asst-bubble').count(), 1);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

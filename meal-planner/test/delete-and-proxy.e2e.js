// Two bugs reported from real use.
//
// 1. Deleting a meal appeared to do nothing when self-hosted. Every Supabase
//    write relied on the realtime subscription to bring the change back, so if
//    realtime wasn't delivering, the write succeeded and the screen never
//    moved. Delete was just the most obvious case; nothing worked.
//
// 2. The AI proxy timed out. The client now reads a streamed reply and names
//    the job, so the server can pick how hard to think.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-delete.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

const mk = (id, name) => ({
  id, name, base:'x', effort:'Low', effortMinutes:20, tier:'often', servings:4,
  method:'1. Cook it.', notes:'', sourceUrl:'', dietFlags:[], lastCooked:'', timesCooked:0,
  ingredients:[{ item:'garlic', quantity:'1', unit:'', section:'produce', pantryStaple:false, flag:null, substitute:'' }],
  macros:{ calories:'', protein:'', carbs:'', fat:'' }
});
const MEALS = [mk('m1','Traybake'), mk('m2','Curry'), mk('m3','Noodles')];
const WEEK = { weekStart:'2026-01-05', mealIds:['m1',null,null], slots:3, checkedItems:{}, started:true };

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}

async function deleteFrom(page, name){
  const row = page.locator('.meal-row', { hasText: name }).first();
  await row.locator('button:has-text("Delete")').click();
  await page.waitForTimeout(250);
  await row.locator('button:has-text("Yes, delete")').click();
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ------------------------------------------------ on-device delete
  let page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await page.addInitScript(({ meals, week }) => {
    localStorage.setItem('mp_meals_v1', JSON.stringify(meals));
    localStorage.setItem('mp_week_v1', JSON.stringify(week));
    localStorage.setItem('mp_pantry_v1', '[]');
    localStorage.setItem('mp_history_v1', '[]');
    window.claude = { use: () => Promise.resolve(null) };
  }, { meals: MEALS, week: WEEK });
  await page.goto('file://' + OUT);
  await page.waitForTimeout(500);
  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(300);

  check('three meals to start', await page.locator('.meal-row').count(), 3);
  await deleteFrom(page, 'Curry');
  check('the row is gone', await page.locator('.meal-row').count(), 2);
  check('and it is gone from storage',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).some(m => m.id === 'm2')), false);
  check('the others survive',
    await page.evaluate(() => JSON.parse(localStorage.getItem('mp_meals_v1')).length), 2);

  // A meal that's in the week can still be deleted.
  await deleteFrom(page, 'Traybake');
  check('a meal in this week deletes too', await page.locator('.meal-row').count(), 1);
  await page.close();

  // ------------------------- self-hosted delete, with realtime DEAD
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await page.addInitScript(({ meals }) => {
    window.MP_CONFIG = { supabaseUrl:'https://stub.supabase.co', supabaseAnonKey:'anon', aiEndpoint:'/api/ai' };
    window.__rows = meals.map(m => ({ id: m.id, data: m }));
    window.__deletes = [];
    const ok = (data) => Promise.resolve({ data, error: null });
    function table(name){
      let filterId = null;
      const api = {
        select(){ return api; },
        eq(_col, val){ filterId = val; return api; },
        order(){ return api; }, limit(){ return api; },
        maybeSingle(){
          if (name === 'weeks')  return ok({ data: { weekStart:'2026-01-05', mealIds:[null,null,null], slots:3, started:true } });
          if (name === 'pantry') return ok({ items: [] });
          return ok(null);
        },
        insert(){ return ok(null); },
        update(){ return ok(null); },
        upsert(){ return ok(null); },
        delete(){
          return { eq(_c, id){ window.__deletes.push(id); window.__rows = window.__rows.filter(r => r.id !== id); return ok(null); } };
        },
        then(res, rej){
          if (name === 'household_members') return ok([{ household_id:'hh-1' }]).then(res, rej);
          if (name === 'meals')   return ok(window.__rows).then(res, rej);
          if (name === 'history') return ok([]).then(res, rej);
          return ok([]).then(res, rej);
        }
      };
      return api;
    }
    window.supabase = { createClient(){ return {
      from: table,
      rpc(){ return ok(null); },
      // Realtime that never delivers anything — the exact condition that made
      // every write look like it did nothing.
      channel(){ const ch = { on(){ return ch; }, subscribe(){ return ch; } }; return ch; },
      auth: {
        getSession(){ return Promise.resolve({ data: { session: { access_token:'tok', user: { id:'u1', email:'rich@example.com' } } } }); },
        onAuthStateChange(){ return { data: { subscription: { unsubscribe(){} } } }; },
        signOut(){ return ok(null); }
      }
    }; } };
  }, { meals: MEALS });
  await page.goto('file://' + OUT);
  await page.waitForTimeout(700);
  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(400);

  check('the household loads its meals', await page.locator('.meal-row').count(), 3);
  await deleteFrom(page, 'Curry');
  check('the delete reached the database',
    await page.evaluate(() => window.__deletes.length), 1);
  check('and it named the right row',
    await page.evaluate(() => window.__deletes[0]), 'm2');
  check('THE SCREEN UPDATES WITHOUT REALTIME', await page.locator('.meal-row').count(), 2);
  check('the right one went', await page.locator('.meal-row', { hasText: 'Curry' }).count(), 0);
  await page.close();

  // ---------------------------- the proxy: streamed, and named
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await page.addInitScript(({ meals, week }) => {
    window.MP_CONFIG = { supabaseUrl:'https://stub.supabase.co', supabaseAnonKey:'anon', aiEndpoint:'/api/ai' };
    window.__posted = [];
    // Answers the way the real proxy does: a stream of plain text, not JSON.
    const realFetch = window.fetch;
    window.fetch = function(url, opts){
      if (String(url).indexOf('/api/ai') !== -1){
        window.__posted.push(JSON.parse(opts.body));
        const body = ' Here you go.\n```json\n{"items":[{"name":"basmati rice","section":"tins-and-dry-goods","low":false}]}\n```';
        return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type':'text/plain' } }));
      }
      return realFetch.apply(this, arguments);
    };
    const ok = (data) => Promise.resolve({ data, error: null });
    // The pantry has to persist here: the app re-reads after every write now,
    // so a stub that forgets would wipe what was just saved.
    window.__pantry = [];
    function table(name){
      const api = { select(){return api;}, eq(){return api;}, order(){return api;}, limit(){return api;},
        maybeSingle(){ if(name==='weeks') return ok({data:week}); if(name==='pantry') return ok({items:window.__pantry}); return ok(null); },
        insert(){return ok(null);}, update(){return ok(null);},
        upsert(row){ if(name==='pantry') window.__pantry = row.items; return ok(null); },
        delete(){ return { eq(){ return ok(null); } }; },
        then(res,rej){ if(name==='household_members') return ok([{household_id:'hh-1'}]).then(res,rej);
          if(name==='meals') return ok(meals.map(m=>({id:m.id,data:m}))).then(res,rej); return ok([]).then(res,rej); } };
      return api;
    }
    window.supabase = { createClient(){ return { from: table, rpc(){ return ok(null); },
      channel(){ const ch={on(){return ch;},subscribe(){return ch;}}; return ch; },
      auth: { getSession(){ return Promise.resolve({data:{session:{access_token:'tok',user:{id:'u1',email:'r@e.com'}}}}); },
        onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, signOut(){ return ok(null); } } }; } };
  }, { meals: MEALS, week: WEEK });
  await page.goto('file://' + OUT);
  await page.waitForTimeout(700);

  await page.click('button.tab:has-text("Pantry")');
  await page.waitForTimeout(400);
  await page.fill('#pantry-input', 'rice');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Add & sort")');
  await page.waitForTimeout(800);

  const posted = await page.evaluate(() => window.__posted);
  check('the request names the job', posted[0].task, 'pantrySort');
  check('and carries the prompt', posted[0].prompt.indexOf('pantry') !== -1, true);
  check('a fenced JSON stream is parsed and written',
    await page.evaluate(() => window.__pantry.length), 1);
  check('and the item landed on screen',
    await page.locator('.pantry-item', { hasText: 'basmati rice' }).count(), 1);

  // An error that arrives after the stream has started is still shown.
  await page.evaluate(() => {
    const realFetch = window.fetch;
    window.fetch = function(url, opts){
      if (String(url).indexOf('/api/ai') !== -1){
        return Promise.resolve(new Response(' \n\n[[MP_ERROR]] The AI service dropped that one — try again.',
          { status: 200, headers: { 'Content-Type':'text/plain' } }));
      }
      return realFetch.apply(this, arguments);
    };
  });
  await page.fill('#pantry-input', 'lentils');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Add & sort")');
  await page.waitForTimeout(700);
  check('a mid-stream failure is reported, not swallowed',
    (await page.locator('.warnbox.info, .g-flag').first().innerText()).indexOf('dropped that one') !== -1, true);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

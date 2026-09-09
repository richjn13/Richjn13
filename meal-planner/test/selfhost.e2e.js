// The self-hosted path: Supabase auth, household scoping, and the fact that
// nothing at all renders until we know who this is and which household they're
// in. supabase-js is stubbed, so this tests OUR wiring — the two gates, the
// row shape we write, and the fallback when the backend can't be reached.
const { chromium } = require('playwright-core');
const fs = require('fs');

const SRC = '/home/user/Richjn13/meal-planner/app/index.html';
const OUT = '/tmp/claude-0/-home-user-Richjn13/7d122444-bd82-5624-b32d-59c350b404c6/scratchpad/runnable-selfhost.html';
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${fs.readFileSync(SRC,'utf8')}\n</body></html>`);

let failures = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}

// A small fake of the slice of supabase-js the app uses. It records every write
// so the test can assert on the exact row shape that would hit Postgres.
const STUB = ({ startSignedIn, startInHousehold, breakInit }) => {
  window.MP_CONFIG = { supabaseUrl: 'https://stub.supabase.co', supabaseAnonKey: 'anon-key', aiEndpoint: '/api/ai' };
  window.__writes = [];
  window.__rpc = [];
  if (breakInit) { window.supabase = { createClient(){ throw new Error('Backend is down'); } }; return; }

  let session = startSignedIn
    ? { access_token: 'tok', user: { id: 'user-1', email: 'rich@example.com' } }
    : null;
  let members = startInHousehold ? [{ household_id: 'hh-1' }] : [];
  const meals = [{ id: 'row-1', data: { name: 'Seeded Traybake', base: 'butter beans', tier: 'often', servings: 4, method: 'Cook.', ingredients: [], macros: {} } }];
  let listeners = [];

  const ok = (data) => Promise.resolve({ data, error: null });

  function table(name){
    const api = {
      select(){ return api; },
      eq(){ return api; },
      order(){ return api; },
      limit(){ return api; },
      maybeSingle(){
        if (name === 'weeks')  return ok({ data: { weekStart: '2026-01-05', mealIds: [null,null,null,null,null], started: true } });
        if (name === 'pantry') return ok({ items: ['olive oil'] });
        if (name === 'households') return ok({ invite_code: 'ABCD1234' });
        return ok(null);
      },
      insert(row){ window.__writes.push({ table: name, op: 'insert', row }); return ok(null); },
      update(row){ window.__writes.push({ table: name, op: 'update', row }); return ok(null); },
      upsert(row){ window.__writes.push({ table: name, op: 'upsert', row }); return ok(null); },
      delete(){ window.__writes.push({ table: name, op: 'delete' }); return ok(null); },
      then(res, rej){
        // Awaiting the builder itself is what a plain select does.
        if (name === 'household_members') return ok(members).then(res, rej);
        if (name === 'meals')   return ok(meals).then(res, rej);
        if (name === 'history') return ok([]).then(res, rej);
        return ok([]).then(res, rej);
      }
    };
    return api;
  }

  window.supabase = {
    createClient(){
      return {
        from: table,
        rpc(fn, args){
          window.__rpc.push({ fn, args });
          if (fn === 'create_household' || fn === 'join_household'){
            members = [{ household_id: 'hh-1' }];
            return ok({ id: 'hh-1', name: 'Our kitchen', invite_code: 'ABCD1234' });
          }
          if (fn === 'rotate_invite_code') return ok('WXYZ9999');
          return ok(null);
        },
        channel(){ const ch = { on(){ return ch; }, subscribe(){ return ch; } }; return ch; },
        auth: {
          getSession(){ return Promise.resolve({ data: { session } }); },
          onAuthStateChange(cb){ listeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; },
          signInWithPassword({ email }){
            session = { access_token: 'tok', user: { id: 'user-1', email } };
            listeners.forEach(cb => cb('SIGNED_IN', session));
            return ok({ session });
          },
          signUp({ email }){
            // Mimics email-confirmation-on: a user, but no session yet.
            return Promise.resolve({ data: { user: { id: 'user-2', email }, session: null }, error: null });
          },
          signOut(){ session = null; members = []; listeners.forEach(cb => cb('SIGNED_OUT', null)); return ok(null); }
        }
      };
    }
  };
};

async function boot(page, opts){
  await page.addInitScript(STUB, opts);
  await page.goto('file://' + OUT);
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // --- signed out: the app must not render at all ---
  let page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, { startSignedIn: false, startInHousehold: false });
  check('signed out shows the sign-in screen', await page.locator('#auth-email').count(), 1);
  check('and no tabs at all', await page.locator('button.tab').count(), 0);
  check('and no meal list', await page.locator('.meal-row').count(), 0);

  await page.click('button:has-text("Create an account")');
  await page.waitForTimeout(200);
  check('can switch to sign-up', (await page.locator('h2').first().innerText()).indexOf('Create an account') !== -1, true);

  // Sign-up with confirmation on tells them to go and check their email.
  await page.fill('#auth-email', 'wife@example.com');
  await page.fill('#auth-password', 'a-good-password');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(400);
  check('sign-up without a session says to confirm the email',
    (await page.locator('.warnbox.info').innerText()).indexOf('Check your email') !== -1, true);
  await page.close();

  // --- signed in but no household: the second gate ---
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, { startSignedIn: true, startInHousehold: false });
  check('no household shows the setup screen', await page.locator('#hh-code').count(), 1);
  check('the app is still not rendered', await page.locator('button.tab').count(), 0);
  check('it says who is signed in', (await page.locator('.card').first().innerText()).indexOf('rich@example.com') !== -1, true);

  // Joining by code goes through the RPC, not a raw insert into the members table.
  await page.fill('#hh-code', 'ABCD1234');
  await page.click('button:has-text("Join")');
  await page.waitForTimeout(700);
  const rpcs = await page.evaluate(() => window.__rpc);
  check('join went through the RPC', rpcs[0].fn, 'join_household');
  check('and passed the code', rpcs[0].args.code, 'ABCD1234');
  check('the app renders once in a household', await page.locator('button.tab').count() > 0, true);
  check('and loads the household\'s meals',
    (await page.locator('button.tab:has-text("Meals")').count()), 1);
  await page.close();

  // --- signed in and in a household: normal operation ---
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, { startSignedIn: true, startInHousehold: true });
  check('goes straight to the app', await page.locator('button.tab').count() > 0, true);
  await page.click('button.tab:has-text("Meals")');
  await page.waitForTimeout(300);
  check('rows come from the database', await page.locator('.m-name-btn').first().innerText(), 'Seeded Traybake');

  // A rank change must write an UPDATE scoped to the row, not an insert.
  await page.locator('.meal-row').first().locator('select.tier-select').selectOption('rarely');
  await page.waitForTimeout(500);
  let writes = await page.evaluate(() => window.__writes);
  check('editing writes an update', writes[0].op, 'update');
  check('to the meals table', writes[0].table, 'meals');
  check('carrying the whole record as jsonb', writes[0].row.data.tier, 'rarely');
  check('and stamping who did it', writes[0].row.updated_by, 'user-1');

  // A new meal must carry the household id, or row-level security rejects it.
  await page.click('button:has-text("+ Add meal")');
  await page.waitForTimeout(300);
  await page.fill('#f-name', 'Brand New Meal');
  await page.click('button:has-text("Save meal")');
  await page.waitForTimeout(600);
  writes = await page.evaluate(() => window.__writes);
  const insert = writes.filter(w => w.op === 'insert' && w.table === 'meals')[0];
  check('a new meal is an insert', !!insert, true);
  check('scoped to the household', insert.row.household_id, 'hh-1');
  check('with the record in data', insert.row.data.name, 'Brand New Meal');

  // The invite code is fetched on demand, never rendered by default.
  await page.click('button.tab:has-text("Import")');
  await page.waitForTimeout(300);
  check('the code is not shown until asked', (await page.locator('.card', { hasText: 'Household' }).innerText()).indexOf('ABCD1234'), -1);
  await page.click('button:has-text("Show the invite code")');
  await page.waitForTimeout(400);
  check('and then it is', (await page.locator('.warnbox.info').first().innerText()).indexOf('ABCD1234') !== -1, true);
  await page.click('button:has-text("Make a new code")');
  await page.waitForTimeout(500);
  check('rotating replaces it', (await page.locator('.warnbox.info').first().innerText()).indexOf('WXYZ9999') !== -1, true);

  // Signing out drops straight back to the gate.
  await page.click('button:has-text("Sign out")');
  await page.waitForTimeout(600);
  check('sign out returns to the sign-in screen', await page.locator('#auth-email').count(), 1);
  check('and the app is gone', await page.locator('button.tab').count(), 0);
  await page.close();

  // --- a broken backend must not leave a blank page ---
  page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR:', e.message); failures++; });
  await boot(page, { breakInit: true });
  check('a failed backend still renders the app', await page.locator('button.tab').count() > 0, true);
  check('and says why', (await page.locator('.warnbox.warn').first().innerText()).indexOf('Backend is down') !== -1, true);
  check('with the on-device footnote',
    (await page.locator('.footnote').innerText()).indexOf('this device only') !== -1, true);
  await page.close();

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

# Setting it up for real

What Claude can't do for you: create accounts, hold your keys, or click Deploy.
Everything else is written and committed. This is the list of things only you
can do, in the order they have to happen.

Budget about an hour, most of it waiting for dashboards.

## What you need before you start

Three free accounts, and nothing else:

- **Supabase** — the database and the logins.
- **Vercel** — serves the page and runs the one function. It gives you a URL
  like `meal-planner-xyz.vercel.app` when you import the repo. That URL *is*
  your site.
- **Anthropic** — an API key for the AI features. This is the only one that
  costs anything, and at two people planning a week it is pennies a month.
  Note that API billing is **separate from a Claude.ai subscription**: Pro or
  Max does not include it, and a fresh API account with no credit fails every
  call. See step 4.

**You do not need to buy a domain or already own a website.** The page has to be
served from somewhere because a browser loads it over the web, and Vercel is
that somewhere, for free. A custom domain is optional and purely cosmetic — add
one later if you want `meals.something.com` instead.

Supabase on its own is not enough: it holds the data but does not serve the app.

---

## Before anything

Open the app as it is today and use **Import → Copy a backup**. Paste it into a
file and keep it somewhere that isn't this app. Every step below is reversible
as long as you have that.

---

## 1. Supabase

1. Create a free project at supabase.com. Any region near you.
2. **SQL Editor → New query.** Paste all of `supabase/schema.sql`, run it. It
   creates the tables, the household model, the row-level security policies and
   the three functions that let someone join a household.
3. **Authentication → Providers:** make sure Email is on.
4. **Authentication → URL Configuration:** leave this until after step 3, when
   Vercel has given you a URL. Then paste that URL into *Site URL* and add it to
   *Redirect URLs*. This is the only place the two services need to know about
   each other, and it is why the deploy has to come first.
5. **Project Settings → API:** copy the **Project URL** and the **anon /
   publishable key**.

The anon key is meant to be in a browser — row-level security is what protects
the data, not that key. The **service_role** key is the opposite: it bypasses
every policy. Never put that one anywhere near the front end.

## 2. Try it locally first

```
cd meal-planner
npm install
cp web/config.example.js web/config.js     # fill in the URL and anon key
npm run build
npx serve dist                              # or any static server
```

`web/config.js` is gitignored and never leaves your machine. Open the local URL
and you should get a sign-in screen. If you get the app straight away with a
"Saved on this device only" footnote, the config didn't load.

The build prints which config it used. It will shout at you if it found none —
that mode has no accounts, no shared list and no AI, and shipping it by accident
is the failure that looks like success.

## 3. Deploy it

**Vercel** is the documented path: a static site plus one function, free at this
size, and `vercel.json` is already in the repo.

1. Import the GitHub repo at vercel.com. It creates the URL for you — nothing
   to buy, no DNS to set up.
2. **Root Directory: `meal-planner`.** This matters — the repo has other things
   in it. Everything else (build command, output directory) comes from
   `vercel.json`.
3. Add the environment variables in step 4 before the first deploy.

The build generates `dist/config.js` from `SUPABASE_URL` and `SUPABASE_ANON_KEY`
at build time, so nothing with a key in it is ever committed.

Netlify and Cloudflare Pages work too; `api/ai.ts` carries the exact change each
one needs at the top of the file.

## 4. The AI proxy and the keys

`api/ai.ts` is the only thing that ever sees your Anthropic key. It runs on
Vercel's Edge runtime, refuses any request without a valid Supabase session
token, and rate limits to 20 calls per user per minute.

Set all four as environment variables **in the host's dashboard**, never in the
repo:

| Variable | Where it comes from | Used by |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys → Create key | the function only |
| `SUPABASE_URL` | Project Settings → API → Project URL | the function and the build |
| `SUPABASE_ANON_KEY` | Project Settings → API → anon key | the function and the build |

Two optional ones, if you want to change which model answers:

| Variable | Default | Effect |
| --- | --- | --- |
| `AI_MODEL` | `claude-sonnet-5` | Everything the app asks for |
| `AI_MODEL_HEAVY` | same as `AI_MODEL` | Recipe adjustments and the assistant only |

Sonnet 5 is the default at $2 / $10 per million tokens in and out. Opus 5 is
$5 / $25 — the same work at a higher rate, not more of it. Haiku 4.5 at $1 / $5
is cheaper again and fine for extraction, though it is the one likeliest to
misread a scanned recipe.

If the assistant starts guessing which meal you meant, or an adjustment comes
back sloppy, set `AI_MODEL_HEAVY=claude-opus-5`. Only the two jobs that actually
reason use it, so the extra cost lands where the judgement is needed.

Both Supabase variables need to be available **at build time as well as at
runtime** — the build writes them into `dist/config.js` for the browser. On
Vercel that is the default; just don't restrict them to the function.

Gating the proxy on a session token matters: an open proxy is a free API key for
whoever finds it, and scanners find them within days.

**Getting the Anthropic key.** At console.anthropic.com, under API keys, create
one and copy it straight away — it is shown once. Two things about billing:

- It is **not** covered by a Claude.ai Pro or Max subscription. They are
  separate products on the same login. A new API account starts with no credit
  and every call fails with a billing error, which reads like a broken key.
  Add a payment method or buy credit under Billing first.
- Set a **monthly spend limit** while you are in there. Two people planning
  dinners cannot realistically run up a bill, but a limit means a bug cannot
  either.

The key goes in the host's environment and nowhere else. Not in the repo, not in
`config.js`, not in a commit you mean to undo later — a key in a git history is
a key that has leaked.

**Cost.** Anthropic bills per token. The app calls it for PDF extraction, tidying
the grocery list, adjusting a recipe and estimating macros — each one a fraction
of a cent at Claude Opus 5 rates ($5 per million input tokens, $25 per million
output). Two people planning a week each is well under a dollar a month.
Bulk-importing a large PDF library is the only thing that would register at all.
If it ever matters, change `MODEL` in `api/ai.ts` to `claude-sonnet-5` ($2/$10)
or `claude-haiku-4-5` ($1/$5).

Once it deploys, go back and finish Supabase step 1.4 with the URL Vercel gave
you. Sign-in will not work until you do.

## 5. Check the security model (optional, 2 minutes)

The schema's whole job is that one household cannot see another's data. If you
want to see that proven rather than take my word for it, run it locally:

```
createdb mp_test
psql -v ON_ERROR_STOP=1 -d mp_test -f supabase/local-prelude.sql
psql -v ON_ERROR_STOP=1 -d mp_test -f supabase/schema.sql
psql -v ON_ERROR_STOP=1 -d mp_test -f supabase/rls-test.sql
```

It creates three users, has two share a household and one stand outside it, and
raises an exception if the outsider can read or write anything of theirs —
including when they name the other household's id directly.

## 6. First run

1. Open the deployed site. You get a sign-in screen. If you don't, the config
   didn't build — check the two Supabase variables.
2. Create your account, then **Start a new household**.
3. **Import → Household → Show the invite code.** Send the code to your wife.
4. She creates her own account and enters the code. One shared list, two logins.
5. **Import → Restore from a backup:** paste the backup from the top of this
   page and choose **Add what's missing**. Check the meal count matches before
   you touch anything else.

## 7. Install it on your phones

Open the site in Safari or Chrome and use *Add to Home Screen*. It runs
full-screen with its own icon and opens instantly. That is the whole of "stage
2" — for two people it may well be where this should stop.

---

## If something goes wrong

**"Couldn't reach the server" banner.** The app fell back to on-device storage
and says so. Nothing syncs in that state. Usually a wrong URL or key.

**No sign-in screen at all, and the footnote says "this device only".** The
build found no Supabase config, so it shipped the on-device version. Check that
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are set for the build, not only the
function.

**Your wife's account never arrives.** Supabase requires email confirmation by
default. Either she clicks the link, or you turn confirmation off under
Authentication → Providers → Email while it's just the two of you.

**Signed in, but the app says "one more step" forever.** You have an account but
no household. Create one or enter an invite code — that screen is the fix, not
an error.

**AI buttons return "Signed in first".** The proxy couldn't validate the session
token; check `SUPABASE_URL` and `SUPABASE_ANON_KEY` on the function, not just on
the site.

**A write silently does nothing.** Almost always a row-level security policy: the
row's `household_id` doesn't match the caller's household. Supabase logs the
rejection under Logs → Postgres.

---

## What is deliberately not built yet

- **Password reset.** Supabase can send the email; the app has no screen for it.
  Half a day.
- **Leaving a household / removing a member.** The policy allows it, there's no
  button.
- **Account deletion.** Not needed for two people; required by Apple before any
  App Store submission.
- **Anything for the app stores.** See `DEPLOYMENT.md` — that decision should
  wait until you have both used this for a few months.

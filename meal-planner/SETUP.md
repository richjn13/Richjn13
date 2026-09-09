# Setting it up for real

What Claude can't do for you: create accounts, hold your keys, or click Deploy.
Everything else is written and committed. This is the list of things only you
can do, in the order they have to happen.

Budget about an hour, most of it waiting for dashboards.

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
4. **Authentication → URL Configuration:** once you know your site URL (step 3
   below), add it to *Site URL* and *Redirect URLs*.
5. **Project Settings → API:** copy the **Project URL** and the **anon /
   publishable key**.

The anon key is meant to be in a browser — row-level security is what protects
the data, not that key. The **service_role** key is the opposite: it bypasses
every policy. Never put that one anywhere near the front end.

## 2. Local config

```
cp web/config.example.js web/config.js
```

Fill in the project URL and anon key. `web/config.js` is gitignored.

```
node build.mjs
```

That writes `dist/` — the deployable site. It reads `app/index.html`, which
stays the single source of truth and stays publishable as a Claude artifact.

## 3. Hosting

Cloudflare Pages, Netlify or Vercel; all free at this size.

- **Build command:** `node meal-planner/build.mjs`
- **Output directory:** `meal-planner/dist`
- **Functions directory:** `meal-planner/api`

`web/config.js` is gitignored, so either commit a config for the deploy
environment or have the host write it at build time from environment variables.
The simplest honest option for two people: commit `web/config.js` to a private
repo. If the repo is public, generate it in the build step instead.

## 4. The AI proxy

`api/ai.ts` is the only thing that ever sees your Anthropic key.

```
npm i @anthropic-ai/sdk @supabase/supabase-js
```

Set these as environment variables **in the host's dashboard**, never in the
repo:

| Variable | Where it comes from |
| --- | --- |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `SUPABASE_URL` | same Project URL as above |
| `SUPABASE_ANON_KEY` | same anon key as above |

The proxy refuses any request without a valid Supabase session token and rate
limits to 20 calls per user per minute. Both matter: an open proxy is a free
API key for whoever finds it, and scanners find them within days.

**Cost.** Anthropic bills per token. The app calls it for PDF extraction, tidying
the grocery list, adjusting a recipe and estimating macros — each one a fraction
of a cent at Claude Opus 5 rates ($5 per million input tokens, $25 per million
output). Two people planning a week each is well under a dollar a month.
Bulk-importing a large PDF library is the only thing that would register at all.
If it ever matters, change `MODEL` in `api/ai.ts` to `claude-sonnet-5` ($2/$10)
or `claude-haiku-4-5` ($1/$5).

## 5. First run

1. Open the deployed site. You get a sign-in screen.
2. Create your account, then **Start a new household**.
3. **Import → Household → Show the invite code.** Send the code to your wife.
4. She creates her own account and enters the code. One shared list, two logins.
5. **Import → Restore from a backup:** paste the backup from the top of this
   page and choose **Add what's missing**. Check the meal count matches before
   you touch anything else.

## 6. Install it on your phones

Open the site in Safari or Chrome and use *Add to Home Screen*. It runs
full-screen with its own icon and opens instantly. That is the whole of "stage
2" — for two people it may well be where this should stop.

---

## If something goes wrong

**"Couldn't reach the server" banner.** The app fell back to on-device storage
and says so. Nothing syncs in that state. Usually a wrong URL or key in
`config.js`.

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

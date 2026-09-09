# Taking this out of the artifact

Written 2026-09-09. The app currently runs as a Claude artifact. That gives it
two things for free — a shared realtime database (`claude.use('db')`) and AI
calls with no API key on the client (`claude.use('sample')`) — and both
disappear the moment it's hosted anywhere else.

This is what replacing them costs, in that order, with the decisions that
actually matter flagged.

## Where it stands

- One HTML file, ~3,200 lines, no build step, no dependencies except pdf.js.
- Ten Playwright suites, ~212 assertions, all green.
- Data lives in four collections: `meals`, `week/current`, `pantry/current`,
  `history`. Every write goes through six functions (`saveMeal`, `deleteMeal`,
  `saveWeek`, `savePantry`, `saveHistoryEntry`, `deleteHistoryEntry`), each of
  which already branches between the artifact database and localStorage.
- Export/import ships a versioned JSON snapshot (`schemaVersion: 1`), which is
  both the backup and the migration path. **Take one before doing any of this.**

## Stage 1 — hosting for two people

The smallest thing that is genuinely better than the artifact, not worse.

**Static host.** Cloudflare Pages, Netlify or Vercel. Free at this size. The
app is one file; deployment is a git push.

**Auth and database.** Supabase is the recommendation: Postgres, realtime
subscriptions, and email/password plus magic-link auth in one product, with a
free tier that covers two users comfortably (paid starts around $25/month if
you outgrow it). Firebase is the main alternative and its realtime model is
closer to what the app already uses; Supabase wins on it being ordinary SQL
you can query and export.

The work: replace the `if (db)` branch in those six functions with Supabase
calls, and add a login screen. The read path is four `onSnapshot` handlers that
map cleanly onto Supabase realtime channels.

**Households, not just users.** This is the part worth getting right up front,
because retrofitting it later means migrating live data. Every row gets a
`household_id`; a user belongs to one household; row-level security policies
filter on it. Two accounts in one household see one shared list — which is
exactly the shape you and your wife need, and also exactly what a third user
would need later. Doing it now costs an extra column and one policy per table.
Doing it after launch costs a migration.

**The AI proxy.** The API key must never reach the browser — anyone with dev
tools open can read it, and a leaked key bills to you. So the three AI features
(PDF extraction, tidy list, adjust recipe, estimate macros) go through a small
serverless function that holds the key server-side and forwards the request:

    browser → /api/ai (your function, holds ANTHROPIC_API_KEY) → Anthropic API

One TypeScript function using `@anthropic-ai/sdk`, deployed alongside the static
site. Gate it behind the Supabase session token so it can't be used by anyone
who isn't logged in, and rate-limit per user — an open proxy is someone else's
free API key.

**Running cost, honestly:** hosting free, Supabase free, and the AI is the only
real variable. Anthropic bills per token; at Claude Opus 5 rates ($5 per million
input tokens, $25 per million output) a recipe extraction is a fraction of a
cent, and two people planning one week each is negligible — call it under a
dollar a month. Bulk-importing a large PDF library is the only thing that would
show up on a bill, and even then it's small. Sonnet 5 ($2/$10) or Haiku 4.5
($1/$5) would cut it further if it ever mattered; it probably won't at this
scale.

**Rough effort:** two to three days of focused work.

## Stage 2 — installable on your phones

Add a web app manifest, icons and a service worker, and the same site installs
to the home screen on iOS and Android with no store involved. Offline reading of
this week and the grocery list is a natural extra once a service worker exists.

For two people this is very likely where it should stop. It looks and behaves
like an app, it costs nothing, and it updates when you push.

**Rough effort:** half a day.

## Stage 3 — the app stores, if it ever comes to that

Be clear-eyed about this one.

Wrapping the PWA with Capacitor produces real iOS and Android builds from the
same source. That part is straightforward. The cost is everything around it:

- Apple developer account $99/year, Google $25 once.
- **Apple guideline 4.2 (minimum functionality)** rejects apps that are
  essentially a website in a wrapper. A meal planner with offline support,
  notifications and native share is defensible; a thin shell is not. Budget for
  at least one rejection and a resubmission.
- Shipping to strangers means a privacy policy, a support contact, account
  deletion (Apple requires in-app deletion for any app with accounts), and
  someone answering support mail.
- Every future change goes through review.

None of that is hard. All of it is ongoing, and it is a different kind of
commitment from the two stages above. The honest advice: don't start it until
the two of you have used stage 2 for a few months and know what the app should
actually be.

## Order of work

1. Export a backup. Keep it somewhere that isn't this app.
2. Decide the backend (Supabase recommended) and create the project.
3. Model the schema with `household_id` on every table and row-level security
   from the first migration, not later.
4. Swap the six write functions and four read subscriptions.
5. Add the login screen and an invite flow — one household, two accounts.
6. Stand up the AI proxy, gated on the session token.
7. Import the backup into the new database. Verify against the artifact copy.
8. Deploy, install on both phones, and live on it for a while before deciding
   whether stage 3 is real.

## What not to do

- Don't put the Anthropic API key in the client, in any form, however
  temporarily. Keys in a git history are keys that leak.
- Don't skip household scoping to "add it when there are more users". Live data
  migrations are the expensive kind.
- Don't self-host on GitHub Pages and call it done — without a backend the app
  silently falls back to per-browser localStorage, and you and your wife each
  get a private list that never syncs. It looks like it works, which is worse
  than it not working.

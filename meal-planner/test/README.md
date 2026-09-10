# Tests

Fifteen Playwright suites drive the real page in Chromium with `window.claude`
stubbed, so the app runs in its localStorage mode and `sample` returns a canned
response. They exist because reading this code repeatedly produced fixes that
looked right and weren't; every suite below started as a bug that inspection
missed.

| Suite | What it pins down |
| --- | --- |
| `edit-form` | The meal form. Clicking a plain field must not save-and-close it; an AI adjustment must rewrite the **method**, not just the ingredients; hand-typed notes survive it; removing a row keeps it removed; save persists. |
| `grocery-pantry` | One line per item with a combined total and per-recipe amounts underneath; the three pantry layers (override > literal > AI); "butter" must not match "butter beans". |
| `merge-duplicates` | The AI tidy pass collapses garlic / garlic cloves and ginger / fresh ginger into one line and sums them, without swallowing things that merely sound alike. |
| `macros` | The arithmetic: per serving × servings, summed across the week, averaged back. An adjustment that omits a value must not wipe it. |
| `macro-estimate` | A meal with no macros still shows the section and offers to estimate; an estimate is labelled as one; typing over it clears that label. |
| `week-detail` | Per-slot macros, the per-meal breakdown table, targets, the inline "tweak" editor (including that Cancel cancels and 0 servings is refused), and pantry coverage per recipe. |
| `grocery-filter` | Filtering the list to one meal rebuilds it from that meal, so garlic reads 3 cloves and not the week's 5. |
| `grocery-page` | The list on its own tab; a tick survives an item moving between the buy list and the cupboard; copy skips ticked items; a new week drops last week's pantry guesses but keeps learned wording. |
| `week-size` | A week is any size from 1 to 10: growing is free, shrinking past a slot that holds a meal names the pick it would lose and waits, the floor and ceiling hold, auto-pick fills exactly the week, and a new week keeps the chosen size. |
| `assistant` | The assistant proposes and never writes: nothing changes before Apply, unticking a change excludes it, Discard writes nothing, an action naming a meal that doesn't exist is dropped rather than guessed at, and a clarifying question suppresses changes entirely. |
| `pantry` | The rebuilt pantry: old plain-string lists still read, an AI add never invents an item nobody typed, saying you're low on something already listed flags it rather than being skipped as a duplicate, and the old "what can we make" is gone. |
| `selfhost` | The Supabase path with a stubbed client: nothing renders until you are signed in AND in a household, joins go through the RPC rather than a raw insert, writes carry `household_id` and land as jsonb, and a backend that can't be reached falls back to this device loudly instead of showing a blank page. |
| `backup` | Export/import: a snapshot round-trips without loss, merge never overwrites what's in front of you, importing the same backup twice doesn't double anything, and a backup from a newer schema is refused rather than half-read. |
| `cook-checklist` | Cook mode's per-step ingredient checklist, above all the matching: "add the butter beans" must not pull in dairy butter, "melt the butter, then add the butter beans" must show both, and "bring to the boil" must not match olive oil. |
| `cook-history` | Cook mode's step parser (messy numbering stripped and re-applied); marking cooked lands on both the meal and the week; starting a new week files the old one; a renamed meal doesn't rewrite what history says you ate. |

The recurring theme in `edit-form` is one mechanism: `render()` re-reads the form
DOM back into the draft to protect in-progress typing, which silently reverted
anything set programmatically until `renderFromDraft()` was introduced. The same
protection now covers the inline editors on This Week.

## Running

```
npm install playwright-core
node edit-form.e2e.js      # or any other suite
```

Each suite is standalone and exits non-zero on failure. Point `executablePath`
at a Chromium build if `/opt/pw-browsers` isn't present.

## Writing a new one

Seed `localStorage` in `page.addInitScript` and stub `window.claude.use` to
return a fixed `sample`. Assert against rendered text and against what actually
landed in `localStorage` — several real bugs looked correct on screen and wrote
nothing, or wrote to a store the page never read back.

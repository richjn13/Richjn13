# Meal Planner, Project Brief

This file explains what the app is meant to do and why. Read it before writing any code. It is the reference for scope, rules and defaults.

## What this is

A personal meal planning app for one household. It holds a running list of meals, helps pick five of them each week, and turns those five into a grocery list grouped by shop section.

It is not a recipe discovery app. Nothing is recommended from outside the list. Every meal in the app is one the household already chose to put there.

## The problem

The planning currently happens in a chat window against a markdown file. That works but it has three weaknesses.

- The list is hard to scan. There is no way to filter by protein, effort or tier without reading the whole thing.
- Recipes drift. A meal gets cooked, something changes, and the change only survives if someone remembers to write it down.
- The grocery list gets rebuilt from scratch every week even though the same ten meals keep coming round.

The app should fix those three things and nothing else at first.

## Core concepts

### Meal

The central object. A meal has

- `name`
- `base` — the main protein or base, for example chicken thighs, butter beans, gluten free pasta
- `effort` — a short human string such as "Low, 30 min, one pan", plus a numeric `effortMinutes` for sorting
- `tier` — one of `often`, `sometimes`, `rarely`, `unranked`
- `servings` — defaults to 4
- `method` — a short summary of how it is actually made, in the household's own words rather than copied from a source
- `notes` — free text for substitutions, storage, what changed last time
- `sourceUrl` — optional, one per meal
- `lunchQuality` — `strong`, `ok`, `weak`, describing whether it holds up the next day
- `dietFlags` — which of the household rules it breaks as written, and the workable substitute
- `ingredients` — structured, see below
- `lastCooked` — date
- `timesCooked` — integer

A meal must survive its source link disappearing. Links rot and paywalls appear, so the method and ingredients live in the record, not behind the URL.

### Tier

Four values, set by the user only. The app never moves a meal between tiers on its own. It may prompt after a cook, but the user decides.

- `often` — in the rotation most weeks or every other week
- `sometimes` — roughly monthly
- `rarely` — a few times a year
- `unranked` — new, not cooked enough to place

### Ingredient

Structured so the grocery list can be generated rather than typed.

- `item`
- `quantity` and `unit`
- `section` — produce, protein, dairy and chilled, tins and dry goods, freezer, other
- `pantryStaple` — boolean, so it lands in the "check the cupboard" list rather than the buy list
- `flag` — optional, one of `not-gluten-free`, `not-vegan`, `contains-egg`
- `substitute` — optional, shown next to a flagged item

### Week plan

Five meals for a given week, plus generated grocery output. A week is not a schedule. It does not assign meals to specific days. Five meals cover roughly five dinners and the lunches carried from them, which leaves two loose nights that the app should name rather than hide.

### Cook log

An entry each time a meal is made. Records the date, any changes, and an optional tier prompt. This is what keeps the recipes from drifting silently.

## The weekly pick

The app suggests five meals. The user accepts, swaps or overrides. Suggestion rules, in rough priority order.

1. Two or three from `often`, one or two from `sometimes`, one from `rarely` or `unranked`.
2. Every week includes at least one `rarely` or `unranked` meal so the list keeps moving.
3. At least two of the five must have `lunchQuality` of `strong` or `ok`.
4. Balance effort. Never five long cooks in one week.
5. Vary the base across the five. Not four chicken meals.
6. Prefer overlapping ingredients so one purchase covers two meals.
7. Respect cooldowns. `often` can repeat week to week, `sometimes` waits about a month, `rarely` waits longer. Use `lastCooked` to enforce this.

The app should show a one line reason next to each pick, offer two alternates, and say plainly when a week looks too heavy, too repetitive or short on lunch coverage. A quiet bad suggestion is worse than a blunt warning.

## The grocery list

Generated from the five picks, in the same session.

- Grouped by shop section in a fixed order — produce, protein, dairy and chilled, tins and dry goods, freezer, everything else.
- Every line labelled with the meal it belongs to. If one item covers two meals, both are named so the quantity makes sense.
- Quantities scale from servings. Default is four per meal.
- Flagged items show the problem and the substitute together, on the same line, so the decision can be made standing in the shop.
- Where there is no good substitute, say so rather than offering something that will not work.
- Split into what needs buying and what to check in the cupboard first.
- Flag anything bought in a small amount for a single meal, so waste is visible.
- Must be readable on a phone in a shop. Big tap targets, check off as you go, no horizontal scrolling.

## Household defaults

These are hard constraints on the data model, not preferences to be toggled per meal.

- Gluten free is a hard rule. The app should flag the easy misses automatically — soy sauce, stock, oats, pasta, gnocchi, sauces, spice blends, tortillas, breadcrumbs.
- No eggs in anything cooked at home, including hidden ones such as binders, washes, mayonnaise and fresh pasta.
- Mostly vegan. Meat and dairy are allowed but should be a deliberate choice, so the app defaults to the plant based option when a dish works either way.
- Two adults. Each meal cooks four servings, two for dinner and two carried into lunch.
- Equipment on hand includes a Ninja Creami, a sous vide setup and a silicone cupcake pan.

## Build order

### v1, the thing worth having

- Add, edit and view meals
- Filter and sort by tier, base, effort and lunch quality
- Import a meal from a URL or pasted text, extracting name, base, effort and method
- Manual weekly pick with the rules shown as warnings rather than enforced
- Grocery list generation, grouped, labelled, flagged
- Works on a phone

### v2

- Automatic weekly suggestion using the rules above
- Cook log and the tier prompt after cooking
- Shared ingredient detection across picks
- Export the grocery list to a notes app or a share sheet

### v3, only if v1 and v2 earn it

- Printable recipe book export, formatted for sharing
- Multiple households or accounts
- Photos

## Non goals

- No recipe discovery, no browsing a public database, no algorithmic recommendations from outside the list.
- No calorie or macro tracking.
- No day by day calendar assignment.
- No social features.
- No account system in v1. Single user, local first.

## Suggested shape

Not binding, but this is the recommendation.

- Local first with a single source of truth in a plain data file, ideally a format that can still be read by a human if the app dies. The current markdown list is the migration source.
- A web app that installs to the home screen beats a native app here. The shop list is the only screen that needs to work well on a phone, and it needs no device APIs.
- Keep the pick rules as data, not scattered through the code. They will change once real weeks get planned against them.

## Open decisions

These need answering before v1 architecture is fixed.

1. Is this ever shared with a second person, or is single user permanent? It changes whether sync is needed.
2. Does the URL import need to handle paywalled sites? Several sources are behind one, which means pasted text has to be a first class input rather than a fallback.
3. Should the app hold full recipes with step by step method, or stay an index with short summaries? The current system keeps full methods separate and only writes one once a meal has been cooked twice.
4. Offline in the shop. If the grocery list must work with no signal, that constrains the storage choice from day one.

## Migration

The existing meal list is a markdown file with one entry per meal under tier headings. It is the seed data. The importer should handle it once and then it can be retired.

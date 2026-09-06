# Recipe PDFs

Drop the household's recipe PDFs in this folder. This is the seed data for
the Meal Planner app described in `../../PROJECT_BRIEF.md` — each PDF here
is a source a future importer reads to fill out a `Meal` record (name,
base, effort, method, ingredients).

## Adding a PDF

1. Upload the file directly into this folder (`meal-planner/recipes/pdfs/`)
   via GitHub's web UI ("Add file" → "Upload files"), or drop it here in a
   session and it'll get committed on the next push.
2. Name it after the meal, lowercase, hyphenated — e.g.
   `chicken-thigh-traybake.pdf`. That filename becomes the meal's `name`
   candidate when it's imported, so keep it recognizable.
3. One PDF per meal. If a PDF covers several meals, split it before adding.

## Why PDFs instead of just a URL

Per the brief: "A meal must survive its source link disappearing." A PDF
is a durable copy of the source that doesn't depend on the original page
staying up. It's still just an import source, not the record itself —
once a meal is imported, its `method` and `ingredients` live in the app's
own data, and the PDF stays here as the original reference.

## What happens to these

Nothing automatic yet. Once the importer exists (v1: "Import a meal from
a URL or pasted text, extracting name, base, effort and method"), it will
extend to read PDFs from this folder the same way. Until then, this
folder is just the inbox — add, replace, or remove PDFs freely as the
household's list changes.

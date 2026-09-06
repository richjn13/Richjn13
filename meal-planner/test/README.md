# Tests

`edit-form.e2e.js` drives the real page in Chromium via Playwright, with
`window.claude` stubbed so the app runs in its localStorage mode and `sample`
returns a canned adjustment. It covers the failure modes that kept recurring by
inspection alone:

- clicking a plain field inside the meal form must not save-and-close it
- an AI adjustment must rewrite the **method** textarea, not just the ingredients
- notes typed by hand survive an adjustment (the AI note is appended, not swapped in)
- removing an ingredient row keeps it removed
- "Mark cooked today" actually applies
- saving persists what's on screen

These all share one mechanism: `render()` re-reads the form DOM back into the
draft to protect in-progress typing, which silently reverted anything set
programmatically until `renderFromDraft()` was introduced.

## Running

```
npm install playwright-core
node edit-form.e2e.js
```

Point `executablePath` at a Chromium build if `/opt/pw-browsers` isn't present.

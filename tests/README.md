# BrightBridge PH — Automated Tests

Plain Node scripts, no test framework, no build step, no CI workflow —
consistent with the rest of this project. Every suite loads and exercises
the real production source files directly (`app.js`, `topic-validation.js`,
`math-validation.js`, `netlify/functions/generate.js`, the `grade{N}-topics.json`
catalog files) — never a hand-copied reimplementation or a line-number
snapshot of production logic.

## Running all tests

```
node tests/run-all.js
```

Runs all 10 suites, prints each suite's output as it runs, then a summary
table and a total pass/fail count. Exits with a non-zero status code if any
suite has a failing assertion or crashes, and names the failing suite in
the summary.

To run a single suite directly:

```
node tests/test_topic_validation.js
```

Every suite can be run from any working directory — all paths are resolved
relative to the file itself (`__dirname`), never hardcoded to a particular
machine or user account.

## What these tests do and don't do

- **No live network calls.** Nothing here calls the real Anthropic API,
  Supabase, or Netlify. `netlify/functions/generate.js` is tested by
  `require()`-ing it directly and replacing the global `fetch` with a
  scripted mock that returns canned responses (see
  `test_generate_function.js` / `test_generate_topic.js`). Browser-side
  code (`app.js`) is tested by executing it inside a Node `vm` context with
  a minimal fake DOM (see `tests/helpers/fake-dom.js`) and a fake `fetch`/
  `supabase` client (see `tests/helpers/load-app-sandbox.js`) — never a
  real browser, never a real database.
- **No database migration is applied or required** to run these tests.
- **Tests exercise real production code paths**, not reimplementations:
  - Topic validation tests `require('../topic-validation.js')` directly.
  - Server-side generation tests `require('../netlify/functions/generate.js')`
    directly (with `fetch` mocked).
  - UI/prompt-building tests execute the real `../app.js` via
    `tests/helpers/load-app-sandbox.js`, including actually *calling*
    `generateWorksheet()` and capturing what it sends, rather than
    extracting or re-typing a copy of its logic.
  - Math-validation tests `require('../math-validation.js')` directly.
  - Catalog-compatibility tests read the real `../grade{N}-topics.json`
    files from disk and dynamically discover however many exist — no
    hardcoded file count, no hardcoded topic count. It reports the current
    total and longest topic for visibility but never asserts an exact
    number, so legitimate future catalog growth can't break the suite.

## Files

```
tests/
  run-all.js                       - runs all suites, prints a summary, exits non-zero on failure
  test_math_validation.js          - math-validation.js unit tests
  test_topic_validation.js         - topic-validation.js unit tests
  test_catalog_compatibility.js    - every grade*-topics.json topic against the real validator
  test_prompt_build.js             - executes real app.js generateWorksheet(), captures the real prompt
  test_wiring.js                   - app.js <-> shared-module wiring (no duplicate/drifted logic)
  test_quota_display.js            - client quota display counts only is_chargeable=true rows
  test_printable_math_render.js    - buildPrintableMathHtml() rendering + XSS/escaping behavior
  test_generate_function.js        - netlify/functions/generate.js control-flow (mocked fetch)
  test_generate_topic.js           - generate.js custom-topic validation/policy/analytics tagging
  test_topic_ui.js                 - custom-topic UI state machine (catalog/editing/active states)
  helpers/
    load-app-sandbox.js            - loads/executes real app.js in a vm context with stubs
    fake-dom.js                    - minimal fake document/element sufficient to run app.js
    run.js                         - shared run()/assert() test primitives (sync + async safe)
```

## Adding a future suite

1. Create `tests/test_<name>.js`. Requires should resolve production files
   relative to the test file, e.g.:
   ```js
   const path = require('path');
   const thing = require(path.join(__dirname, '..', 'some-production-file.js'));
   ```
   or, for anything touching `app.js`/DOM/fetch/Supabase, use the existing
   helpers:
   ```js
   const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
   const { makeDocument } = require('./helpers/fake-dom.js');
   const { run, assert } = require('./helpers/run.js');
   ```
2. Write assertions against the real production behavior — never
   reimplement the logic under test inside the test file, and never persist
   a hand-copied snapshot of production source that could go stale. If you
   need to inspect a specific function's source for a structural check
   (e.g. "this function must never reference field X"), locate it by a
   stable marker (its `function name(` declaration line, or the next
   top-level `function` after it) and fail loudly with a clear error if the
   marker can't be found — never a fixed line number.
3. Add the new file name to the `SUITES` array in `run-all.js`.
4. Run `node tests/run-all.js` to confirm it's picked up and passing.

No framework, no `package.json` test dependency, and no CI workflow are
part of this change — if either is ever wanted, that's a separate decision.

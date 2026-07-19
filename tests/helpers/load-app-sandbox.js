// tests/helpers/load-app-sandbox.js
//
// Loads and executes the REAL production app.js (plus the real shared
// math-validation.js / topic-validation.js modules it depends on) inside a
// Node vm context, so tests exercise the actual production code path --
// never a hand-copied or line-number-extracted snapshot. All paths are
// resolved relative to this file via __dirname, so these tests run
// correctly regardless of the current working directory or machine.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..', '..');

function repoPath(...segments) {
  return path.join(REPO_ROOT, ...segments);
}

function readAppJsSource() {
  return fs.readFileSync(repoPath('app.js'), 'utf8');
}

function loadMathValidation() {
  return require(repoPath('math-validation.js'));
}

function loadTopicValidation() {
  return require(repoPath('topic-validation.js'));
}

function defaultSupabaseStub() {
  return {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => {}
      },
      from: () => ({})
    })
  };
}

/**
 * Runs the real app.js source in a fresh vm context.
 *
 * options.document   - a fake `document` (see tests/helpers/fake-dom.js)
 * options.fetch       - a fake `fetch` function
 * options.window      - extra/overriding properties merged onto the
 *                        sandbox's `window` (e.g. a custom `supabase`
 *                        stub); MathValidation/TopicValidation/supabase
 *                        defaults are always provided unless overridden
 *                        here.
 * options.extraSandbox - any additional top-level sandbox globals app.js
 *                        might reference (rare; prefer window.* instead).
 * options.extraCode    - JS source appended AFTER app.js's own source,
 *                        before execution -- used only to expose small
 *                        test-only bridge functions/state accessors, never
 *                        to redefine production logic.
 *
 * Returns the sandbox object. Every top-level `let`/`const`/`function` in
 * app.js becomes a property on this object (Node's vm module attaches
 * script-level bindings to the context), so tests can read/set module
 * state (e.g. sandbox.topicSource) and call real functions directly
 * (e.g. sandbox.generateWorksheet()).
 */
function createAppSandbox(options) {
  options = options || {};
  const mathValidation = loadMathValidation();
  const topicValidation = loadTopicValidation();

  const sandbox = Object.assign(
    {
      console,
      document: options.document,
      fetch: options.fetch,
      window: Object.assign(
        {
          MathValidation: mathValidation,
          TopicValidation: topicValidation,
          supabase: defaultSupabaseStub()
        },
        options.window
      )
    },
    options.extraSandbox
  );
  sandbox.global = sandbox;
  vm.createContext(sandbox);

  const code = readAppJsSource() + (options.extraCode || '');
  vm.runInContext(code, sandbox, { filename: 'app.js' });

  return sandbox;
}

module.exports = {
  REPO_ROOT,
  repoPath,
  readAppJsSource,
  loadMathValidation,
  loadTopicValidation,
  createAppSandbox
};

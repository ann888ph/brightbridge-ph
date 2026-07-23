// Confirms app.js correctly wires up the shared math-validation.js /
// topic-validation.js modules (no duplicate/drifted copy of their logic
// baked into app.js itself) and sends the expected fields to generate.js.
// Loads the REAL app.js via the shared helper -- no hand-copied source.
const { createAppSandbox, readAppJsSource, loadMathValidation } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

const mathValidation = loadMathValidation();
const appJsSource = readAppJsSource();

let sandbox;
run('app.js loads without throwing when window.MathValidation/TopicValidation are provided', () => {
  sandbox = createAppSandbox({
    document: makeDocument(),
    extraCode: `
function __test_getParseQuizJson() { return parseQuizJson; }
`
  });
});

run('parseQuizJson is accessible in app.js scope', () => {
  sandbox.parseQuizJson = sandbox.__test_getParseQuizJson();
  assert(typeof sandbox.parseQuizJson === 'function', 'expected parseQuizJson to be destructured into app.js scope');
});

run('app.js uses the exact same parseQuizJson reference as the shared module (no duplicate copy)', () => {
  assert(sandbox.parseQuizJson === mathValidation.parseQuizJson, 'expected app.js to reference the shared module function directly, not a copy');
});

run('app.js no longer references validateMathQuestions at all (Math validation is server-authoritative now)', () => {
  // Not merely unused -- genuinely absent from the source, so it can't
  // quietly come back as dead/duplicate client-side validation logic.
  assert(!/validateMathQuestions/.test(appJsSource), 'expected app.js to never reference validateMathQuestions');
});

run('generateWorksheet() sends items, quarter, and topicSource in the POST body to generate.js', () => {
  assert(
    /prompt, subject, mode: wsMode,\s*\n\s*grade, quarter, topic, topicSource, difficulty, activity, items,/.test(appJsSource),
    'expected items/quarter/topicSource to be present in the request body construction'
  );
});

// ---------------------------------------------------------------------
// REV 4: getMathActivityProfile must be the SINGLE shared source of truth
// for the mode+activity -> schema/validation profile decision -- app.js
// and generate.js must both call it rather than each re-deriving the same
// three booleans with their own (potentially drifting) formula.
// ---------------------------------------------------------------------
const path = require('path');
const fs = require('fs');
const generateJsSource = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'generate.js'), 'utf8');

run('getMathActivityProfile is exported from math-validation.js', () => {
  assert(typeof mathValidation.getMathActivityProfile === 'function', 'expected getMathActivityProfile to be exported');
});

run('SOURCE CHECK: app.js calls the SHARED getMathActivityProfile helper rather than re-deriving the profile inline', () => {
  assert(appJsSource.includes('window.MathValidation.getMathActivityProfile('), 'expected app.js to call the shared helper via window.MathValidation');
  // Guards against a future edit reintroducing a second, independently
  // written copy of the FULL three-predicate formula (not the unrelated,
  // pre-existing `wsMode === 'interactive' || isMath` used elsewhere to
  // pick the JSON-vs-freehand-HTML prompt path -- this specifically looks
  // for the activity-profile shape, "printable" && activity ===).
  assert(!/wsMode === 'interactive' \|\| \(wsMode === 'printable' && activity ===/.test(appJsSource), 'found an inlined requiresMultipleChoice-style formula in app.js -- must go through the shared helper instead');
});

run('SOURCE CHECK: generate.js calls the SHARED getMathActivityProfile helper rather than re-deriving the profile inline', () => {
  assert(generateJsSource.includes('getMathActivityProfile(mode, activity)'), 'expected generate.js to call the shared helper');
  assert(!/mode === ['"]printable['"] && activity ===/.test(generateJsSource), 'found an inlined requiresMultipleChoice-style formula in generate.js -- must go through the shared helper instead');
});

run('SOURCE CHECK: generate.js requires getMathActivityProfile from the shared math-validation.js module (not a second implementation)', () => {
  assert(
    /const\s*\{[^}]*getMathActivityProfile[^}]*\}\s*=\s*require\("\.\.\/\.\.\/math-validation\.js"\)/.test(generateJsSource),
    'expected getMathActivityProfile to be part of the destructured require of the shared math-validation.js module'
  );
});

console.log('\nDone.');

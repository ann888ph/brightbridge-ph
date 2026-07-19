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

console.log('\nDone.');

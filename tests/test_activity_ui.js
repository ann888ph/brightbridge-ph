// Tests updateActivityOptionsForSubject() in app.js: Math has no dedicated
// Fill-in-the-Blanks schema/validator/renderer yet, so that option must be
// hidden/disabled while Subject = Math, and any prior selection of it must
// be safely reset to "Worksheet" rather than left stuck on a disabled
// value. Exercises the REAL app.js via the shared vm-sandbox helper -- no
// hand-copied reimplementation of the function under test.
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

// Matches the real <select id="activity"> options in index.html exactly.
const ACTIVITY_OPTIONS = ['', 'Worksheet', 'Multiple Choice Quiz', 'Reading Comprehension', 'Matching Type', 'Fill in the Blanks', 'Parent/Tutor Support Sheet'];

// The fake DOM has no HTML parser -- unlike a real browser, it never sees
// index.html's static <option> markup, so this test seeds the SAME option
// values app.js's own updateSubjects()/generateWorksheet() code already
// assumes are present, using the same document.createElement()/appendChild()
// pattern production code uses elsewhere.
function seedActivityOptions(fakeDocument, initialValue) {
  const select = fakeDocument.getElementById('activity');
  ACTIVITY_OPTIONS.forEach((val) => {
    const opt = fakeDocument.createElement('option');
    opt.value = val;
    select.appendChild(opt);
  });
  select.value = initialValue || '';
  return select;
}

function makeSandboxWithActivitySelect(initialValue) {
  const fakeDocument = makeDocument();
  const sandbox = createAppSandbox({ document: fakeDocument });
  seedActivityOptions(fakeDocument, initialValue);
  return sandbox;
}

function fillBlankOption(sandbox) {
  const select = sandbox.document.getElementById('activity');
  return select.options.find((o) => o.value === 'Fill in the Blanks');
}

run('Subject = English: Fill in the Blanks stays enabled/selectable, prior selection untouched', () => {
  const sandbox = makeSandboxWithActivitySelect('Fill in the Blanks');
  sandbox.updateActivityOptionsForSubject('English');
  const opt = fillBlankOption(sandbox);
  assert(!opt.disabled, 'expected Fill in the Blanks to remain enabled for a non-Math subject');
  assert(!opt.hidden, 'expected Fill in the Blanks to remain visible for a non-Math subject');
  assert(sandbox.document.getElementById('activity').value === 'Fill in the Blanks', 'expected the selection to be left alone for a non-Math subject');
});

run('TRANSITION: Subject changed English -> Math while Fill in the Blanks is selected: option becomes disabled+hidden AND value resets to Worksheet, same call', () => {
  const sandbox = makeSandboxWithActivitySelect('Fill in the Blanks');
  sandbox.updateActivityOptionsForSubject('Math');
  const opt = fillBlankOption(sandbox);
  assert(opt.disabled, 'expected Fill in the Blanks to become disabled for Math');
  assert(opt.hidden, 'expected Fill in the Blanks to become hidden for Math');
  assert(sandbox.document.getElementById('activity').value === 'Worksheet', 'expected the selection to safely reset to Worksheet, got: ' + sandbox.document.getElementById('activity').value);
});

run('Subject = Math from the start (nothing previously selected): option is disabled/hidden with no prior selection needed', () => {
  const sandbox = makeSandboxWithActivitySelect('');
  sandbox.updateActivityOptionsForSubject('Math');
  const opt = fillBlankOption(sandbox);
  assert(opt.disabled && opt.hidden, 'expected Fill in the Blanks disabled/hidden for Math even with no prior selection');
});

run('TRANSITION: Subject changed Math -> English: option is re-enabled', () => {
  const sandbox = makeSandboxWithActivitySelect('Worksheet');
  sandbox.updateActivityOptionsForSubject('Math');
  sandbox.updateActivityOptionsForSubject('English');
  const opt = fillBlankOption(sandbox);
  assert(!opt.disabled && !opt.hidden, 'expected Fill in the Blanks re-enabled after switching back to a non-Math subject');
});

run('Subject = Math with a DIFFERENT activity already selected (Worksheet): selection is left alone, not reset unnecessarily', () => {
  const sandbox = makeSandboxWithActivitySelect('Worksheet');
  sandbox.updateActivityOptionsForSubject('Math');
  assert(sandbox.document.getElementById('activity').value === 'Worksheet', 'expected the existing non-Fill-in-the-Blanks selection to be preserved');
});

run('Subject = Math, then back to Math again (idempotent): still disabled/hidden, no crash', () => {
  const sandbox = makeSandboxWithActivitySelect('Fill in the Blanks');
  sandbox.updateActivityOptionsForSubject('Math');
  sandbox.updateActivityOptionsForSubject('Math');
  const opt = fillBlankOption(sandbox);
  assert(opt.disabled && opt.hidden, 'expected the option to remain disabled/hidden across repeated Math selections');
  assert(sandbox.document.getElementById('activity').value === 'Worksheet', 'expected value to remain Worksheet, not re-reset or cleared');
});

console.log('\nDone.');

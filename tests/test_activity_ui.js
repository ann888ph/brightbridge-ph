// Tests updateActivityOptionsForSubject() in app.js: PRODUCTION
// CONTAINMENT decision -- Reading Comprehension, Matching Type, and Fill
// in the Blanks are all hidden/disabled while Subject = Math (Reading
// Comprehension/Matching Type were found to have a fragile production
// contract; Fill in the Blanks has no dedicated Math schema/validator/
// renderer at all -- see math-validation.js). Any prior selection of one
// of these three must be safely reset to "Worksheet" rather than left
// stuck on a disabled value. Worksheet, Multiple Choice Quiz, and
// Parent/Tutor Support Sheet remain available for Math throughout.
// Exercises the REAL app.js via the shared vm-sandbox helper -- no
// hand-copied reimplementation of the function under test.
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

// Matches the real <select id="activity"> options in index.html exactly.
const ACTIVITY_OPTIONS = ['', 'Worksheet', 'Multiple Choice Quiz', 'Reading Comprehension', 'Matching Type', 'Fill in the Blanks', 'Parent/Tutor Support Sheet'];

// The three activities currently unavailable for Math.
const MATH_UNAVAILABLE = ['Reading Comprehension', 'Matching Type', 'Fill in the Blanks'];

// The three activities that MUST remain available for Math.
const MATH_AVAILABLE = ['Worksheet', 'Multiple Choice Quiz', 'Parent/Tutor Support Sheet'];

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

function activityOption(sandbox, value) {
  const select = sandbox.document.getElementById('activity');
  return select.options.find((o) => o.value === value);
}

function assertAllUnavailableDisabledAndHidden(sandbox, message) {
  MATH_UNAVAILABLE.forEach((value) => {
    const opt = activityOption(sandbox, value);
    assert(opt.disabled, message + ' -- expected "' + value + '" to be disabled');
    assert(opt.hidden, message + ' -- expected "' + value + '" to be hidden');
  });
}

function assertAllUnavailableEnabledAndVisible(sandbox, message) {
  MATH_UNAVAILABLE.forEach((value) => {
    const opt = activityOption(sandbox, value);
    assert(!opt.disabled, message + ' -- expected "' + value + '" to be enabled');
    assert(!opt.hidden, message + ' -- expected "' + value + '" to be visible');
  });
}

function assertAllAvailableRemainUsable(sandbox, message) {
  MATH_AVAILABLE.forEach((value) => {
    const opt = activityOption(sandbox, value);
    assert(!opt.disabled, message + ' -- expected "' + value + '" to remain enabled for Math');
    assert(!opt.hidden, message + ' -- expected "' + value + '" to remain visible for Math');
  });
}

run('Subject = English: all three unstable activities stay enabled/selectable, prior selection untouched', () => {
  MATH_UNAVAILABLE.forEach((selected) => {
    const sandbox = makeSandboxWithActivitySelect(selected);
    sandbox.updateActivityOptionsForSubject('English');
    assertAllUnavailableEnabledAndVisible(sandbox, 'English + "' + selected + '" selected');
    assert(sandbox.document.getElementById('activity').value === selected, 'expected the selection to be left alone for a non-Math subject, got: ' + sandbox.document.getElementById('activity').value);
  });
});

run('TRANSITION: Subject changed English -> Math while an unstable activity is selected: all three become disabled+hidden AND value resets to Worksheet, same call', () => {
  MATH_UNAVAILABLE.forEach((selected) => {
    const sandbox = makeSandboxWithActivitySelect(selected);
    sandbox.updateActivityOptionsForSubject('Math');
    assertAllUnavailableDisabledAndHidden(sandbox, 'Math after selecting "' + selected + '"');
    assertAllAvailableRemainUsable(sandbox, 'Math after selecting "' + selected + '"');
    assert(sandbox.document.getElementById('activity').value === 'Worksheet', 'expected the selection to safely reset to Worksheet after selecting "' + selected + '", got: ' + sandbox.document.getElementById('activity').value);
  });
});

run('Subject = Math from the start (nothing previously selected): all three unstable activities are disabled/hidden with no prior selection needed', () => {
  const sandbox = makeSandboxWithActivitySelect('');
  sandbox.updateActivityOptionsForSubject('Math');
  assertAllUnavailableDisabledAndHidden(sandbox, 'Math from a blank start');
  assertAllAvailableRemainUsable(sandbox, 'Math from a blank start');
});

run('TRANSITION: Subject changed Math -> English: all three unstable activities are re-enabled/shown', () => {
  const sandbox = makeSandboxWithActivitySelect('Worksheet');
  sandbox.updateActivityOptionsForSubject('Math');
  sandbox.updateActivityOptionsForSubject('English');
  assertAllUnavailableEnabledAndVisible(sandbox, 'after switching back to English');
});

run('Subject = Math with an available activity already selected (Worksheet/Multiple Choice Quiz/Parent-Tutor Support Sheet): selection is left alone, not reset unnecessarily', () => {
  MATH_AVAILABLE.forEach((selected) => {
    const sandbox = makeSandboxWithActivitySelect(selected);
    sandbox.updateActivityOptionsForSubject('Math');
    assert(sandbox.document.getElementById('activity').value === selected, 'expected the existing "' + selected + '" selection to be preserved for Math, got: ' + sandbox.document.getElementById('activity').value);
  });
});

run('Subject = Math, then back to Math again (idempotent): still disabled/hidden, no crash, selection stays reset', () => {
  const sandbox = makeSandboxWithActivitySelect('Matching Type');
  sandbox.updateActivityOptionsForSubject('Math');
  sandbox.updateActivityOptionsForSubject('Math');
  assertAllUnavailableDisabledAndHidden(sandbox, 'repeated Math selection');
  assert(sandbox.document.getElementById('activity').value === 'Worksheet', 'expected value to remain Worksheet, not re-reset or cleared');
});

run('SESSION RESET: clearSessionState() (logout) restores all three unstable activities so no disabled state remains on a shared device', () => {
  const sandbox = makeSandboxWithActivitySelect('Reading Comprehension');
  sandbox.updateActivityOptionsForSubject('Math');
  assertAllUnavailableDisabledAndHidden(sandbox, 'before logout (Math selected)');
  sandbox.clearSessionState();
  assertAllUnavailableEnabledAndVisible(sandbox, 'after clearSessionState() (logout)');
  assert(sandbox.document.getElementById('activity').value === '', 'expected the activity selection itself to be cleared on logout, got: ' + sandbox.document.getElementById('activity').value);
});

console.log('\nDone.');

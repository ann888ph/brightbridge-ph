// DOM-interaction tests for the Searchable/Custom Topics UI state machine
// in app.js: showCustomTopicInput/hideCustomTopicInput/useCustomTopic/
// selectSuggestedTopic/onCustomTopicInput/resetCustomTopicUI. Loads the
// REAL app.js via the shared helper; uses the shared fake DOM (not a real
// browser) since these are pure state/visibility transitions, not layout.
const { createAppSandbox, readAppJsSource } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

const appJsSource = readAppJsSource();

function buildSandbox() {
  return createAppSandbox({
    document: makeDocument(),
    extraCode: `
function __test_getState() { return { topicSource, activeCustomTopic }; }
function __test_setTopicList(grade, subject, quarter, list) {
  gradeTopicsCache[grade] = gradeTopicsCache[grade] || {};
  gradeTopicsCache[grade][subject] = gradeTopicsCache[grade][subject] || {};
  gradeTopicsCache[grade][subject][grade] = { [quarter]: list };
}
function __test_setNoTopicList(grade, subject) {
  gradeTopicsCache[grade] = gradeTopicsCache[grade] || {};
  gradeTopicsCache[grade][subject] = {}; // present subject, but no [grade] key -> "no topic list yet"
}
`
  });
}

(async () => {

// ---------------------------------------------------------------------
// State machine transitions
// ---------------------------------------------------------------------

await run('Initial state: topicSource defaults to catalog, no custom topic active', () => {
  const sandbox = buildSandbox();
  const state = sandbox.__test_getState();
  assert(state.topicSource === 'catalog', 'expected default topicSource to be catalog, got ' + state.topicSource);
  assert(state.activeCustomTopic === '', 'expected no active custom topic initially');
});

await run('showCustomTopicInput(): hides catalog select + link, shows the custom block', () => {
  const sandbox = buildSandbox();
  sandbox.document.getElementById('grade').value = 'Grade 4';
  sandbox.document.getElementById('subject').value = 'Math';
  sandbox.document.getElementById('quarter').value = 'Quarter 1';
  sandbox.showCustomTopicInput();
  assert(sandbox.document.getElementById('topic').style.display === 'none', 'expected catalog select hidden');
  assert(sandbox.document.getElementById('showCustomTopicBtn').style.display === 'none', 'expected toggle link hidden');
  assert(sandbox.document.getElementById('customTopicBlock').style.display === 'flex', 'expected custom block shown');
  assert(sandbox.document.getElementById('customTopicActiveRow').style.display === 'none', 'expected active-row hidden while editing');
});

await run('onCustomTopicInput(): empty input shows no error and no use-row', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = '';
  sandbox.onCustomTopicInput();
  assert(sandbox.document.getElementById('customTopicUseRow').style.display === 'none', 'expected use-row hidden for empty input');
  assert(sandbox.document.getElementById('customTopicError').style.display === 'none', 'expected no error shown for empty (unstarted) input');
});

await run('onCustomTopicInput(): valid text shows an ENABLED use-button with the NORMALIZED text (via textContent, not innerHTML)', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = 'Fractions using Filipino recipes';
  sandbox.onCustomTopicInput();
  const useBtn = sandbox.document.getElementById('useCustomTopicBtn');
  assert(useBtn.disabled === false, 'expected the use-button enabled for valid input');
  assert(useBtn.textContent === 'Use "Fractions using Filipino recipes" as a custom topic', 'unexpected button text: ' + useBtn.textContent);
  assert(sandbox.document.getElementById('customTopicError').style.display === 'none', 'expected no error for valid input');
});

await run('onCustomTopicInput(): valid text with extra whitespace shows the NORMALIZED (collapsed/trimmed) text in the button, not the raw keystrokes', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = '   Fractions   using   Filipino recipes  ';
  sandbox.onCustomTopicInput();
  const useBtn = sandbox.document.getElementById('useCustomTopicBtn');
  assert(useBtn.textContent === 'Use "Fractions using Filipino recipes" as a custom topic', 'expected the normalized (not raw) topic in the button, got: ' + useBtn.textContent);
});

await run('onCustomTopicInput(): invalid text (URL) shows a DISABLED use-button with a GENERIC label (no echo) and a friendly error message', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = 'https://example.com/topic';
  sandbox.onCustomTopicInput();
  const useBtn = sandbox.document.getElementById('useCustomTopicBtn');
  assert(useBtn.disabled === true, 'expected the use-button disabled for an invalid (URL) input');
  assert(useBtn.textContent === 'Use custom topic', 'expected the generic disabled label, not the raw URL, got: ' + useBtn.textContent);
  assert(!useBtn.textContent.includes('example.com'), 'expected the invalid URL to never be echoed into the button label');
  const errorEl = sandbox.document.getElementById('customTopicError');
  assert(errorEl.style.display !== 'none', 'expected an error message to be shown');
  assert(/without links, code, or instructions/.test(errorEl.textContent), 'expected the updated friendly error message, got: ' + errorEl.textContent);
});

await run('onCustomTopicInput(): XSS/script payload is NEVER echoed into the disabled button label -- generic "Use custom topic" text only', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = '<script>alert(1)</script>';
  sandbox.onCustomTopicInput();
  const useBtn = sandbox.document.getElementById('useCustomTopicBtn');
  assert(useBtn.disabled === true, 'expected the use-button disabled for a script payload');
  assert(useBtn.textContent === 'Use custom topic', 'expected the generic disabled label, got: ' + useBtn.textContent);
  assert(!useBtn.textContent.includes('<script>'), 'expected the raw script payload to never be echoed into the button label at all, valid text or not');
  assert(!useBtn.textContent.includes('alert(1)'), 'expected no fragment of the payload to leak into the button label');
});

await run('onCustomTopicInput(): switching from invalid back to valid input restores the normalized-topic label (not stuck on the generic one)', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  const input = sandbox.document.getElementById('customTopicInput');
  const useBtn = sandbox.document.getElementById('useCustomTopicBtn');

  input.value = '<script>alert(1)</script>';
  sandbox.onCustomTopicInput();
  assert(useBtn.textContent === 'Use custom topic', 'expected the generic label while invalid');

  input.value = 'Budgeting for a school project';
  sandbox.onCustomTopicInput();
  assert(useBtn.textContent === 'Use "Budgeting for a school project" as a custom topic', 'expected the normalized-topic label restored once the input becomes valid, got: ' + useBtn.textContent);
  assert(useBtn.disabled === false, 'expected the button re-enabled once valid');
});

await run('SOURCE CHECK: useCustomTopicBtn is only ever assigned via .textContent, never .innerHTML, anywhere in app.js', () => {
  assert(!/useCustomTopicBtn['"\]]*\.innerHTML/.test(appJsSource), 'expected useCustomTopicBtn to never be assigned via innerHTML');
});

await run('SOURCE CHECK: customTopicActiveText is only ever assigned via .textContent, never .innerHTML', () => {
  assert(!/customTopicActiveText['"\]]*\.innerHTML/.test(appJsSource), 'expected customTopicActiveText to never be assigned via innerHTML');
});

await run('useCustomTopic(): valid topic -> topicSource becomes "custom", active row shown with the normalized text', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = '  Fractions   using Filipino recipes  ';
  sandbox.onCustomTopicInput();
  sandbox.useCustomTopic();

  const state = sandbox.__test_getState();
  assert(state.topicSource === 'custom', 'expected topicSource to become custom');
  assert(state.activeCustomTopic === 'Fractions using Filipino recipes', 'expected whitespace-normalized topic, got: ' + JSON.stringify(state.activeCustomTopic));

  assert(sandbox.document.getElementById('customTopicBlock').style.display === 'none', 'expected the editing block to hide');
  assert(sandbox.document.getElementById('customTopicActiveRow').style.display === 'flex', 'expected the active-confirmation row to show');
  assert(sandbox.document.getElementById('customTopicActiveText').textContent === 'Fractions using Filipino recipes', 'expected the active row to show the normalized topic text');
});

await run('useCustomTopic(): invalid topic is defensively rejected even if somehow triggered (button should already be disabled)', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = 'ab';
  sandbox.useCustomTopic();
  const state = sandbox.__test_getState();
  assert(state.topicSource === 'catalog', 'expected topicSource to remain catalog when the topic is invalid');
  assert(sandbox.document.getElementById('customTopicError').style.display !== 'none', 'expected an error to be shown');
});

await run('selectSuggestedTopic(): sets the catalog select value + topicSource back to catalog, closes the custom block', () => {
  const sandbox = buildSandbox();
  const topicSelect = sandbox.document.getElementById('topic');
  const opt = sandbox.document.createElement('option');
  opt.tagName = 'option';
  opt.value = 'Basic Fractions';
  topicSelect.appendChild(opt);

  sandbox.showCustomTopicInput();
  sandbox.selectSuggestedTopic('Basic Fractions');

  const state = sandbox.__test_getState();
  assert(state.topicSource === 'catalog', 'expected topicSource to be catalog after picking a suggestion');
  assert(topicSelect.value === 'Basic Fractions', 'expected the catalog select to reflect the picked suggestion');
  assert(sandbox.document.getElementById('customTopicBlock').style.display === 'none', 'expected the custom block to close');
  assert(sandbox.document.getElementById('topic').style.display === '', 'expected the catalog select visible again');
});

await run('hideCustomTopicInput() ("Back to topic list"): fully resets to the catalog state', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = 'Some draft text';
  sandbox.onCustomTopicInput();
  sandbox.hideCustomTopicInput();

  const state = sandbox.__test_getState();
  assert(state.topicSource === 'catalog', 'expected topicSource reset to catalog');
  assert(state.activeCustomTopic === '', 'expected activeCustomTopic cleared');
  assert(sandbox.document.getElementById('customTopicBlock').style.display === 'none', 'expected custom block hidden');
  assert(sandbox.document.getElementById('customTopicInput').value === '', 'expected the draft input cleared');
  assert(sandbox.document.getElementById('topic').style.display === '', 'expected catalog select visible again');
  assert(sandbox.document.getElementById('showCustomTopicBtn').style.display === '', 'expected the toggle link visible again');
});

await run('Switching back from Custom to Catalog and generating does not require a page refresh (pure state, callable repeatedly)', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = 'Budgeting for a school project';
  sandbox.useCustomTopic();
  assert(sandbox.__test_getState().topicSource === 'custom', 'expected custom to be active');

  sandbox.showCustomTopicInput(); // "Change custom topic" -> back into editing
  sandbox.hideCustomTopicInput(); // -> back to catalog
  assert(sandbox.__test_getState().topicSource === 'catalog', 'expected a clean return to catalog state with no leftover custom topic');
  assert(sandbox.__test_getState().activeCustomTopic === '', 'expected no leftover custom topic text');
});

await run('"Change custom topic" (showCustomTopicInput while already custom) prefills the input with the current active topic', () => {
  const sandbox = buildSandbox();
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = 'Reading a local news article';
  sandbox.useCustomTopic();

  sandbox.showCustomTopicInput(); // "Change custom topic"
  assert(sandbox.document.getElementById('customTopicInput').value === 'Reading a local news article', 'expected the input prefilled with the previously active custom topic');
});

await run('No-catalog case (updateTopics with an empty gradeData): auto-opens the custom-topic flow with a distinct helper message', () => {
  const sandbox = buildSandbox();
  sandbox.document.getElementById('grade').value = 'Grade 4';
  sandbox.document.getElementById('subject').value = 'MAPEH';
  sandbox.document.getElementById('quarter').value = 'Quarter 1';
  sandbox.__test_setNoTopicList('Grade 4', 'MAPEH');

  sandbox.updateTopics();

  assert(sandbox.document.getElementById('customTopicBlock').style.display === 'flex', 'expected the custom-topic block to auto-open when no catalog list exists');
  assert(/No curated topic list yet/.test(sandbox.document.getElementById('customTopicHelp').textContent), 'expected a distinct "no catalog" helper message');
});

// ---------------------------------------------------------------------
// STATE RESET COVERAGE (chosen policy, documented): changing ANY of
// Grade, Subject, or Quarter while a custom topic is active always resets
// back to catalog mode -- a custom topic is never silently carried
// forward under a learner setting it was never validated against. Grade
// is the most significant axis (its onchange calls updateSubjects(), NOT
// updateTopics() -- a real gap found and fixed during the original
// review: only Subject/Quarter changes were covered before, Grade changes
// were not).
// ---------------------------------------------------------------------

function activateCustomTopic(sandbox, grade, subject, quarter, topicText) {
  sandbox.document.getElementById('grade').value = grade;
  sandbox.document.getElementById('subject').value = subject;
  sandbox.document.getElementById('quarter').value = quarter;
  sandbox.__test_setTopicList(grade, subject, quarter, ['Basic Fractions']);
  sandbox.showCustomTopicInput();
  sandbox.document.getElementById('customTopicInput').value = topicText;
  sandbox.useCustomTopic();
  assert(sandbox.__test_getState().topicSource === 'custom', 'setup failed: expected custom to be active');
}

function assertFullyResetToCatalog(sandbox, label) {
  const state = sandbox.__test_getState();
  assert(state.topicSource === 'catalog', `[${label}] expected topicSource reset to catalog, got ${state.topicSource}`);
  assert(state.activeCustomTopic === '', `[${label}] expected activeCustomTopic cleared, got ${JSON.stringify(state.activeCustomTopic)}`);
  assert(sandbox.document.getElementById('customTopicActiveRow').style.display === 'none', `[${label}] expected the active-confirmation row hidden`);
  assert(sandbox.document.getElementById('customTopicBlock').style.display === 'none', `[${label}] expected the editing block hidden`);
  assert(sandbox.document.getElementById('topic').style.display === '', `[${label}] expected the catalog select visible again`);
}

await run('STATE RESET: changing GRADE while a custom topic is active resets fully to catalog mode (via updateSubjects(), the real gap found during the original review)', async () => {
  const sandbox = buildSandbox();
  activateCustomTopic(sandbox, 'Grade 4', 'Math', 'Quarter 1', 'Some custom topic for Grade 4');

  sandbox.document.getElementById('grade').value = 'Grade 6'; // simulate the parent changing Grade
  await sandbox.updateSubjects(); // the ACTUAL onchange handler for #grade

  assertFullyResetToCatalog(sandbox, 'Grade change');
});

await run('STATE RESET: changing SUBJECT while a custom topic is active resets fully to catalog mode (via updateTopics())', () => {
  const sandbox = buildSandbox();
  activateCustomTopic(sandbox, 'Grade 4', 'Math', 'Quarter 1', 'Some custom topic for Math');

  sandbox.document.getElementById('subject').value = 'Science'; // simulate the parent changing Subject
  sandbox.__test_setTopicList('Grade 4', 'Science', 'Quarter 1', ['Plant Parts']); // a real catalog exists for the new subject too
  sandbox.updateTopics(); // the ACTUAL onchange handler for #subject

  assertFullyResetToCatalog(sandbox, 'Subject change');
});

await run('STATE RESET: changing SUBJECT to one with NO catalog list auto-opens custom-editing (not "active"), and topicSource is still reset', () => {
  const sandbox = buildSandbox();
  activateCustomTopic(sandbox, 'Grade 4', 'Math', 'Quarter 1', 'Some custom topic for Math');

  sandbox.document.getElementById('subject').value = 'MAPEH'; // deliberately NOT seeded with a topic list
  sandbox.updateTopics();

  const state = sandbox.__test_getState();
  assert(state.topicSource === 'catalog', 'expected topicSource reset to catalog even when the new subject has no list yet');
  assert(state.activeCustomTopic === '', 'expected the stale custom topic text cleared, not carried into the new subject');
  assert(sandbox.document.getElementById('customTopicActiveRow').style.display === 'none', 'expected the OLD active-confirmation row hidden (no stale "Using: ..." carried over)');
  assert(sandbox.document.getElementById('customTopicBlock').style.display === 'flex', 'expected the custom-editing block to auto-open (no-catalog case), starting fresh, not pre-filled with the old topic');
  assert(sandbox.document.getElementById('customTopicInput').value === '', 'expected the input to start empty, NOT prefilled with the previous subject\'s stale custom topic');
});

await run('STATE RESET: changing QUARTER while a custom topic is active resets fully to catalog mode (via updateTopics())', () => {
  const sandbox = buildSandbox();
  activateCustomTopic(sandbox, 'Grade 4', 'Math', 'Quarter 1', 'Some custom topic for Quarter 1');

  sandbox.document.getElementById('quarter').value = 'Quarter 3'; // simulate the parent changing Quarter
  sandbox.updateTopics(); // the ACTUAL onchange handler for #quarter

  assertFullyResetToCatalog(sandbox, 'Quarter change');
});

await run('STATE RESET: a Grade change that keeps the SAME Grade (re-selecting it) also resets -- policy is unconditional, not diff-based', async () => {
  const sandbox = buildSandbox();
  activateCustomTopic(sandbox, 'Grade 4', 'Math', 'Quarter 1', 'Some custom topic');
  await sandbox.updateSubjects(); // fires even without an actual value change, matching real <select> onchange semantics
  assertFullyResetToCatalog(sandbox, 'same-value Grade re-selection');
});

console.log('\nDone.');
})();

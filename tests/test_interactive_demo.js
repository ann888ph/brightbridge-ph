// Tests the static, client-side "Interactive Worksheet Demo" on the login
// page (INTERACTIVE_DEMO_QUESTIONS + openInteractiveDemo()/selectInteractive
// DemoAnswer()/advanceInteractiveDemo()/tryAgainInteractiveDemo()/
// handleInteractiveDemoCreateAccount() in app.js), exercised via the REAL
// production app.js in a vm sandbox (see helpers/load-app-sandbox.js).
// index.html/style.css markup is checked via direct SOURCE CHECKS
// (this project's fake DOM has no HTML parser), consistent with the
// pattern in test_pricing_modal.js/test_samples_section.js.
const fs = require('fs');
const path = require('path');
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

const REPO_ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(REPO_ROOT, 'style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(REPO_ROOT, 'app.js'), 'utf8');

function samplesSectionHtml() {
  const start = indexHtml.indexOf('<section class="samples-section"');
  const end = indexHtml.indexOf('</section>', start);
  assert(start !== -1 && end !== -1, 'expected to find the samples-section block');
  return indexHtml.slice(start, end);
}
const SAMPLES_HTML = samplesSectionHtml();

function makeSandbox() {
  const fakeDocument = makeDocument();
  ['interactiveDemoStartBtn', 'interactiveDemoOverlay', 'interactiveDemoModal', 'interactiveDemoTitle',
   'interactiveDemoProgress', 'interactiveDemoCloseBtn', 'interactiveDemoBody',
   'authEmail', 'authHeading', 'authBtn', 'authCard', 'pricingModalOverlay',
   'auth-screen', 'app', 'userEmail', 'wsCount', 'quotaCount', 'quotaPlanBadge', 'quotaRenew',
   'quotaBlockedText', 'quotaBlocked'
  ].forEach((id) => fakeDocument.getElementById(id));
  // INTERACTIVE_DEMO_QUESTIONS is a top-level `const` and currentUser is a
  // top-level `let` in app.js -- vm.runInContext does not reflect let/const
  // bindings as properties on the context object (only var/function
  // declarations), so small bridge functions are needed to read/set them,
  // matching the same pattern already used in test_topic_ui.js
  // (__test_getState()) and test_quota_display.js (__test_setCurrentUser()).
  return createAppSandbox({
    document: fakeDocument,
    window: {
      supabase: {
        createClient: () => ({
          auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} },
          from: () => ({
            select() { return this; },
            eq() { return this; },
            gte() { return this; },
            order() { return this; },
            single: async () => ({ data: null, error: null }),
            then(resolve) { resolve({ data: [], error: null, count: 0 }); }
          })
        })
      }
    },
    extraCode: `
function __test_getInteractiveDemoQuestions() { return INTERACTIVE_DEMO_QUESTIONS; }
function __test_setCurrentUser(u) { currentUser = u; }
function __test_getInteractiveDemoControls() { return interactiveDemoCurrentControls; }
// The demo's question/choice/feedback/results elements are created via
// document.createElement()/appendChild() at render time (see
// renderInteractiveDemoQuestion()/renderInteractiveDemoResults() in app.js)
// -- they are real elements with real .textContent, but the fake DOM's
// appendChild() (tests/helpers/fake-dom.js) does not serialize children
// into the parent's .innerHTML the way a real browser does, and
// createElement()'d elements are not retrievable via getElementById()
// either. Reading interactiveDemoCurrentControls directly (the same
// module-level tracking app.js itself uses for the focus trap) gives
// tests a real, direct view of what's currently rendered without needing
// either of those.
function __test_getInteractiveDemoRenderState() {
  var c = interactiveDemoCurrentControls;
  return {
    questionText: c.questionEl ? c.questionEl.textContent : null,
    choiceTexts: (c.choiceButtons || []).map(function (b) { return b.textContent; }),
    choiceDisabled: (c.choiceButtons || []).map(function (b) { return !!b.disabled; }),
    choiceMarkedCorrect: (c.choiceButtons || []).map(function (b) { return b.classList.contains('interactive-demo-choice-correct'); }),
    choiceMarkedIncorrect: (c.choiceButtons || []).map(function (b) { return b.classList.contains('interactive-demo-choice-incorrect'); }),
    feedbackText: c.feedbackEl ? c.feedbackEl.textContent : '',
    feedbackIsCorrectStyle: c.feedbackEl ? c.feedbackEl.classList.contains('interactive-demo-feedback-correct') : false,
    feedbackIsIncorrectStyle: c.feedbackEl ? c.feedbackEl.classList.contains('interactive-demo-feedback-incorrect') : false,
    nextBtnText: c.nextBtn ? c.nextBtn.textContent : null,
    nextBtnDisabled: c.nextBtn ? !!c.nextBtn.disabled : null,
    scoreText: c.scoreEl ? c.scoreEl.textContent : null,
    hasTryAgain: !!c.tryAgainBtn,
    hasCreateAccount: !!c.createAccountBtn
  };
}
`
  });
}

// =====================================================================
// 1-2. Teaser appears while logged out, inside #publicSamplesSection
// =====================================================================
run('index.html: the interactive demo teaser appears with the required copy, below the 3 cards and above the CTA', () => {
  const cardsEnd = SAMPLES_HTML.lastIndexOf('</article>');
  const teaserIndex = SAMPLES_HTML.indexOf('id="interactiveDemoStartBtn"');
  const ctaIndex = SAMPLES_HTML.indexOf('class="samples-cta"');
  assert(cardsEnd !== -1 && teaserIndex !== -1 && ctaIndex !== -1, 'expected to find all three markers');
  assert(teaserIndex > cardsEnd, 'expected the interactive demo teaser to be below the 3 printable cards');
  assert(teaserIndex < ctaIndex, 'expected the interactive demo teaser to be above the "Create Your Own Worksheet" CTA');
  assert(SAMPLES_HTML.includes('INTERACTIVE SAMPLE'), 'expected the eyebrow copy');
  assert(SAMPLES_HTML.includes('Try an Interactive Worksheet'), 'expected the heading copy');
  assert(SAMPLES_HTML.includes('Answer a few sample questions and experience how BrightBridge supports learning'), 'expected the supporting text');
  assert(SAMPLES_HTML.includes('Start Interactive Sample'), 'expected the primary button label');
});

run('index.html: the interactive demo modal (teaser + overlay + all controls) is entirely inside #publicSamplesSection', () => {
  assert(SAMPLES_HTML.includes('id="interactiveDemoOverlay"'), 'expected the demo overlay inside the section');
  assert(SAMPLES_HTML.includes('id="interactiveDemoModal"'), 'expected the demo modal inside the section');
  assert(SAMPLES_HTML.includes('id="interactiveDemoBody"'), 'expected the demo body inside the section');
  assert(SAMPLES_HTML.includes('role="dialog"') , 'expected role="dialog" on the demo modal');
});

// =====================================================================
// 3-4. Exactly five static questions, each with 4 choices + 1 valid answer
// =====================================================================
run('app.js: exactly five static INTERACTIVE_DEMO_QUESTIONS, Grade 1 Math Addition Within 20', () => {
  const sandbox = makeSandbox();
  assert(Array.isArray(sandbox.__test_getInteractiveDemoQuestions()), 'expected INTERACTIVE_DEMO_QUESTIONS to be an array');
  assert(sandbox.__test_getInteractiveDemoQuestions().length === 5, 'expected exactly 5 questions, got ' + sandbox.__test_getInteractiveDemoQuestions().length);
});

run('app.js: every question has exactly 4 choices and a valid, arithmetically-correct answer', () => {
  const sandbox = makeSandbox();
  sandbox.__test_getInteractiveDemoQuestions().forEach((q, i) => {
    assert(typeof q.question === 'string' && q.question.length > 0, 'question ' + i + ': expected non-empty question text');
    assert(Array.isArray(q.choices) && q.choices.length === 4, 'question ' + i + ': expected exactly 4 choices, got ' + (q.choices && q.choices.length));
    assert(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4, 'question ' + i + ': expected a valid correctIndex 0-3');
    assert(typeof q.explanation === 'string' && q.explanation.length > 0, 'question ' + i + ': expected a non-empty explanation');
    // Verify the arithmetic: parse "A + B = ?" and confirm choices[correctIndex] is the real sum.
    const m = q.question.match(/^(\d+)\s*\+\s*(\d+)\s*=\s*\?$/);
    assert(m, 'question ' + i + ': expected an "A + B = ?" format, got: ' + q.question);
    const expectedSum = Number(m[1]) + Number(m[2]);
    assert(expectedSum <= 20, 'question ' + i + ': expected the sum to be within 20 (Grade 1 Addition Within 20), got ' + expectedSum);
    assert(Number(q.choices[q.correctIndex]) === expectedSum, 'question ' + i + ': expected choices[correctIndex] to equal ' + expectedSum + ', got ' + q.choices[q.correctIndex]);
    const uniqueChoices = new Set(q.choices);
    assert(uniqueChoices.size === 4, 'question ' + i + ': expected 4 distinct choice values, got duplicates in ' + JSON.stringify(q.choices));
  });
});

run('app.js: the interactive demo never references the generation endpoint, Supabase, quota, or Anthropic', () => {
  const fnMatch = appJs.match(/const INTERACTIVE_DEMO_QUESTIONS[\s\S]*?function resetPublicInteractiveDemo\(\) \{[\s\S]*?\n\}/);
  assert(fnMatch, 'expected to find the full interactive demo block in app.js');
  const block = fnMatch[0];
  assert(!/fetch\(/.test(block), 'the interactive demo must never call fetch()');
  assert(!/\/\.netlify\/functions\//.test(block), 'the interactive demo must never reference a generation/admin endpoint');
  assert(!/supabase|db\.auth|db\.from/i.test(block), 'the interactive demo must never touch Supabase');
  assert(!/reserve_usage_slot|reserve_provider_retry|finalize_validated_generation/.test(block), 'the interactive demo must never reference quota RPCs');
  assert(!/generateWorksheet\(/.test(block), 'the interactive demo must never trigger real worksheet generation');
});

// =====================================================================
// 5-11. Interactive experience: start, answer, feedback, advance, score, retry
// =====================================================================
run('openInteractiveDemo(): opens the modal and shows "Question 1 of 5"', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  const overlay = sandbox.document.getElementById('interactiveDemoOverlay');
  assert(overlay.classList.contains('visible'), 'expected the overlay to open');
  assert(sandbox.document.getElementById('interactiveDemoProgress').textContent === 'Question 1 of 5', 'expected the progress label to read "Question 1 of 5"');
  const state = sandbox.__test_getInteractiveDemoRenderState();
  assert(state.questionText === sandbox.__test_getInteractiveDemoQuestions()[0].question, 'expected the first question text to be rendered, got: ' + state.questionText);
  assert(state.choiceTexts.length === 4, 'expected 4 rendered choice buttons');
  assert(state.nextBtnDisabled === true, 'expected Next to start disabled before any answer is chosen');
});

run('selectInteractiveDemoAnswer(): choosing the CORRECT answer shows correct feedback and increments the score', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  const q0 = sandbox.__test_getInteractiveDemoQuestions()[0];
  sandbox.selectInteractiveDemoAnswer(q0.correctIndex);
  const state = sandbox.__test_getInteractiveDemoRenderState();
  assert(/Correct!/.test(state.feedbackText), 'expected "Correct!" feedback for the right answer, got: ' + state.feedbackText);
  assert(state.feedbackText.includes(q0.explanation), 'expected the short explanation to be shown');
  assert(state.feedbackIsCorrectStyle, 'expected the correct-feedback styling to be applied');
  assert(state.choiceMarkedCorrect[q0.correctIndex] === true, 'expected the correct choice to be visually marked correct');
  assert(state.choiceDisabled.every(Boolean), 'expected all choice buttons to be disabled/locked after answering');
  assert(state.nextBtnDisabled === false, 'expected Next to become enabled after answering');
});

run('selectInteractiveDemoAnswer(): choosing an INCORRECT answer reveals the correct answer + explanation, does not score', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  const q0 = sandbox.__test_getInteractiveDemoQuestions()[0];
  const wrongIndex = (q0.correctIndex + 1) % 4;
  sandbox.selectInteractiveDemoAnswer(wrongIndex);
  const state = sandbox.__test_getInteractiveDemoRenderState();
  assert(/Not quite/.test(state.feedbackText), 'expected "Not quite" feedback for the wrong answer');
  assert(state.feedbackText.includes('The correct answer is ' + q0.choices[q0.correctIndex]), 'expected the correct answer to be revealed, got: ' + state.feedbackText);
  assert(state.feedbackText.includes(q0.explanation), 'expected the short explanation to be shown even when wrong');
  assert(state.feedbackIsIncorrectStyle, 'expected the incorrect-feedback styling to be applied');
  assert(state.choiceMarkedIncorrect[wrongIndex] === true, 'expected the chosen wrong answer to be visually marked incorrect');
  assert(state.choiceMarkedCorrect[q0.correctIndex] === true, 'expected the correct answer to still be revealed/marked even though it was not chosen');
});

run('answers cannot be changed after selection (locked)', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  const q0 = sandbox.__test_getInteractiveDemoQuestions()[0];
  const wrongIndex = (q0.correctIndex + 1) % 4;
  sandbox.selectInteractiveDemoAnswer(wrongIndex);
  // Selecting the CORRECT answer afterward must be a no-op (already locked) --
  // the score must not increment retroactively.
  sandbox.selectInteractiveDemoAnswer(q0.correctIndex);
  const state = sandbox.__test_getInteractiveDemoRenderState();
  assert(/Not quite/.test(state.feedbackText), 'expected the ORIGINAL (wrong) feedback to remain, proving the answer was locked');
});

run('advanceInteractiveDemo(): Next advances exactly one question, and is a no-op before answering', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  sandbox.advanceInteractiveDemo(); // not answered yet -- must be ignored
  assert(sandbox.document.getElementById('interactiveDemoProgress').textContent === 'Question 1 of 5', 'expected Next to be a no-op before answering');
  sandbox.selectInteractiveDemoAnswer(sandbox.__test_getInteractiveDemoQuestions()[0].correctIndex);
  sandbox.advanceInteractiveDemo();
  assert(sandbox.document.getElementById('interactiveDemoProgress').textContent === 'Question 2 of 5', 'expected exactly one question of advancement');
  const state = sandbox.__test_getInteractiveDemoRenderState();
  assert(state.questionText === sandbox.__test_getInteractiveDemoQuestions()[1].question, 'expected question 2\'s text to now be rendered, got: ' + state.questionText);
});

run('FULL RUN: answering all 5 (mixed correct/incorrect) computes the final score correctly', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  const qs = sandbox.__test_getInteractiveDemoQuestions();
  // Answer: correct, correct, wrong, correct, wrong -> expect score 3.
  const pattern = [true, true, false, true, false];
  let expectedScore = 0;
  pattern.forEach((answerCorrectly, i) => {
    const q = qs[i];
    const chosen = answerCorrectly ? q.correctIndex : (q.correctIndex + 1) % 4;
    if (answerCorrectly) expectedScore++;
    sandbox.selectInteractiveDemoAnswer(chosen);
    sandbox.advanceInteractiveDemo();
  });
  const state = sandbox.__test_getInteractiveDemoRenderState();
  assert(state.scoreText === 'You got ' + expectedScore + ' out of 5!', 'expected the final score line "You got ' + expectedScore + ' out of 5!", got: ' + state.scoreText);
});

run('the Next button on the LAST question reads "See My Score", not "Next Question"', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  for (let i = 0; i < 4; i++) {
    sandbox.selectInteractiveDemoAnswer(sandbox.__test_getInteractiveDemoQuestions()[i].correctIndex);
    sandbox.advanceInteractiveDemo();
  }
  assert(sandbox.document.getElementById('interactiveDemoProgress').textContent === 'Question 5 of 5', 'setup: expected to be on question 5');
  const state = sandbox.__test_getInteractiveDemoRenderState();
  assert(state.nextBtnText === 'See My Score', 'expected the final question\'s Next button to read "See My Score", got: ' + state.nextBtnText);
});

// =====================================================================
// Try Again fully resets progress and score
// =====================================================================
run('tryAgainInteractiveDemo(): fully resets progress and score back to Question 1', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  const qs = sandbox.__test_getInteractiveDemoQuestions();
  for (let i = 0; i < 5; i++) {
    sandbox.selectInteractiveDemoAnswer(qs[i].correctIndex);
    sandbox.advanceInteractiveDemo();
  }
  assert(sandbox.__test_getInteractiveDemoRenderState().scoreText === 'You got 5 out of 5!', 'setup: expected a perfect run to reach the results screen');
  sandbox.tryAgainInteractiveDemo();
  assert(sandbox.document.getElementById('interactiveDemoProgress').textContent === 'Question 1 of 5', 'expected Try Again to reset progress to Question 1');
  const state = sandbox.__test_getInteractiveDemoRenderState();
  assert(state.questionText === qs[0].question, 'expected Try Again to show the first question again, got: ' + state.questionText);
  // Answering incorrectly this time and finishing should show score 0, proving the score truly reset (not carried over).
  for (let i = 0; i < 5; i++) {
    const q = sandbox.__test_getInteractiveDemoQuestions()[i];
    sandbox.selectInteractiveDemoAnswer((q.correctIndex + 1) % 4);
    sandbox.advanceInteractiveDemo();
  }
  assert(sandbox.__test_getInteractiveDemoRenderState().scoreText === 'You got 0 out of 5!', 'expected a fresh 0-score run after Try Again, proving the previous score did not carry over');
});

// =====================================================================
// 12. Create Your Free Account switches to Sign Up, scrolls, focuses email
// =====================================================================
run('handleInteractiveDemoCreateAccount(): closes the demo and reuses handleSamplesCta() (Sign Up switch + scroll + focus)', () => {
  const sandbox = makeSandbox();
  const trigger = sandbox.document.getElementById('interactiveDemoStartBtn');
  trigger.focus();
  sandbox.openInteractiveDemo();
  let scrollArgs = null;
  sandbox.document.getElementById('authCard').scrollIntoView = (opts) => { scrollArgs = opts; };
  sandbox.handleInteractiveDemoCreateAccount();
  assert(!sandbox.document.getElementById('interactiveDemoOverlay').classList.contains('visible'), 'expected the demo to close');
  assert(sandbox.document.getElementById('authHeading').textContent === 'Create Your Account', 'expected Sign Up mode to be active');
  assert(scrollArgs && scrollArgs.behavior === 'smooth', 'expected a smooth scroll to the auth card');
  assert(sandbox.document.activeElement === sandbox.document.getElementById('authEmail'), 'expected focus to move to the email field');
});

run('app.js: handleInteractiveDemoCreateAccount() never submits the auth form automatically', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  let authCalled = false;
  sandbox.handleAuth = async () => { authCalled = true; };
  sandbox.handleInteractiveDemoCreateAccount();
  assert(!authCalled, 'expected no automatic form submission');
});

// =====================================================================
// 13. Close, Escape, and backdrop interactions
// =====================================================================
run('closeInteractiveDemo(): the close button (X) closes the modal and returns focus to the trigger', () => {
  const sandbox = makeSandbox();
  const trigger = sandbox.document.getElementById('interactiveDemoStartBtn');
  trigger.focus();
  sandbox.openInteractiveDemo();
  sandbox.closeInteractiveDemo();
  assert(!sandbox.document.getElementById('interactiveDemoOverlay').classList.contains('visible'), 'expected the modal to close');
  assert(sandbox.document.activeElement === trigger, 'expected focus to return to the Start Interactive Sample trigger');
});

run('handleInteractiveDemoKeydown(): Escape closes the demo while open', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  sandbox.handleInteractiveDemoKeydown({ key: 'Escape' });
  assert(!sandbox.document.getElementById('interactiveDemoOverlay').classList.contains('visible'), 'expected Escape to close the demo');
});

run('handleInteractiveDemoOverlayClick(): backdrop click closes the demo; a click on content inside does not', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  sandbox.handleInteractiveDemoOverlayClick({ target: { id: 'interactiveDemoModal' } });
  assert(sandbox.document.getElementById('interactiveDemoOverlay').classList.contains('visible'), 'expected a click on the modal content to leave the demo open');
  sandbox.handleInteractiveDemoOverlayClick({ target: { id: 'interactiveDemoOverlay' } });
  assert(!sandbox.document.getElementById('interactiveDemoOverlay').classList.contains('visible'), 'expected a click on the backdrop itself to close the demo');
});

run('handleInteractiveDemoKeydown(): Tab forward from the LAST focusable control wraps to the close button (never escapes to the page behind)', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  sandbox.selectInteractiveDemoAnswer(sandbox.__test_getInteractiveDemoQuestions()[0].correctIndex); // enables Next, the last control in this view
  const controls = sandbox.__test_getInteractiveDemoControls();
  const closeBtn = sandbox.document.getElementById('interactiveDemoCloseBtn');
  controls.nextBtn.focus(); // simulate the browser having tabbed forward to the last control
  let prevented = false;
  sandbox.handleInteractiveDemoKeydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert(prevented, 'expected Tab from the last control (Next) to be intercepted');
  assert(sandbox.document.activeElement === closeBtn, 'expected focus to wrap forward to the close button, never escaping to the page behind the modal');
});

run('handleInteractiveDemoKeydown(): Shift+Tab from the close button (first control) wraps to the LAST focusable control', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  sandbox.selectInteractiveDemoAnswer(sandbox.__test_getInteractiveDemoQuestions()[0].correctIndex); // enables Next
  // openInteractiveDemo() already focused the close button (the FIRST
  // focusable control), matching a real Shift+Tab-at-the-boundary scenario.
  const controls = sandbox.__test_getInteractiveDemoControls();
  let prevented = false;
  sandbox.handleInteractiveDemoKeydown({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } });
  assert(prevented, 'expected Shift+Tab from the first (close) button to be intercepted');
  assert(sandbox.document.activeElement === controls.nextBtn, 'expected focus to wrap backward to the last control, never escaping to the page behind the modal');
});

run('body scrolling is locked while the demo is open and restored on close', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  assert(sandbox.document.body.classList.contains('interactive-demo-open'), 'expected body scroll lock while open');
  sandbox.closeInteractiveDemo();
  assert(!sandbox.document.body.classList.contains('interactive-demo-open'), 'expected body scroll lock removed on close');
});

// =====================================================================
// 15. Login/authenticated state closes and hides the demo
// =====================================================================
run('showApp(): defensively closes/resets an open interactive demo so no stale modal remains over the authenticated app', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  sandbox.selectInteractiveDemoAnswer(sandbox.__test_getInteractiveDemoQuestions()[0].correctIndex);
  sandbox.__test_setCurrentUser({ id: 'user-1', email: 'parent@example.com' });
  sandbox.showApp();
  assert(!sandbox.document.getElementById('interactiveDemoOverlay').classList.contains('visible'), 'expected showApp() to close the demo modal');
  assert(!sandbox.document.body.classList.contains('interactive-demo-open'), 'expected showApp() to release the scroll lock');
});

run('resetPublicInteractiveDemo(): re-opening after a reset starts fresh at Question 1 with score 0', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  sandbox.selectInteractiveDemoAnswer(sandbox.__test_getInteractiveDemoQuestions()[0].correctIndex);
  sandbox.advanceInteractiveDemo();
  sandbox.resetPublicInteractiveDemo();
  sandbox.openInteractiveDemo();
  assert(sandbox.document.getElementById('interactiveDemoProgress').textContent === 'Question 1 of 5', 'expected a fresh start after reset');
});

// =====================================================================
// 16-17. Pricing modal and printable sample cards remain unchanged
// =====================================================================
run('REGRESSION: the pricing modal still opens/closes correctly, independent of the interactive demo', () => {
  const sandbox = makeSandbox();
  sandbox.openInteractiveDemo();
  sandbox.openPricingModal();
  assert(sandbox.document.getElementById('pricingModalOverlay').classList.contains('visible'), 'expected the pricing modal to open independently of the interactive demo');
  sandbox.closePricingModal();
  assert(!sandbox.document.getElementById('pricingModalOverlay').classList.contains('visible'), 'expected the pricing modal to close independently');
  assert(sandbox.document.getElementById('interactiveDemoOverlay').classList.contains('visible'), 'expected the interactive demo to remain open/unaffected by the pricing modal closing');
});

run('REGRESSION: the three printable sample cards and their PDF links are unchanged', () => {
  assert((SAMPLES_HTML.match(/<article class="sample-card">/g) || []).length === 3, 'expected exactly 3 printable sample cards to remain');
  assert(/sample_worksheets\/Addition_with_Sums_up_to_20\.pdf/.test(indexHtml), 'expected the Math sample PDF link to still be present');
  assert(/sample_worksheets\/Pandiwa_Reference\.pdf/.test(indexHtml), 'expected the Filipino sample PDF link to still be present');
  assert(/sample_worksheets\/Motion_Measuring_Time_and_Distance_Reference\.pdf/.test(indexHtml), 'expected the Science sample PDF link to still be present');
});

// =====================================================================
// 18. Responsive CSS exists for mobile layouts
// =====================================================================
run('style.css: a mobile breakpoint exists for the interactive demo modal (fits viewport, readable choice buttons)', () => {
  assert(/@media \(max-width:\s*640px\)\s*{[^}]*\.interactive-demo-overlay/.test(styleCss), 'expected a mobile breakpoint adjusting the interactive demo modal');
  assert(/\.interactive-demo-choices\s*{[^}]*flex-direction:\s*column/.test(styleCss), 'expected answer buttons to stack vertically (flex-direction: column) at every width, not just mobile');
});

run('style.css: background scroll lock class is defined for the interactive demo', () => {
  assert(/body\.interactive-demo-open\s*{[^}]*overflow:\s*hidden/.test(styleCss), 'expected body.interactive-demo-open to set overflow: hidden');
});

console.log('\nDone.');

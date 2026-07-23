// Tests the "Sample Worksheets" showcase section on the login page:
// index.html markup (SOURCE CHECKS -- this project's fake DOM has no HTML
// parser, consistent with the pattern in test_wiring.js/test_pricing_modal.js)
// and handleSamplesCta()/toggleAuthMode() behavior, exercised via the REAL
// production app.js in a vm sandbox (see helpers/load-app-sandbox.js).
const fs = require('fs');
const path = require('path');
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

const REPO_ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(REPO_ROOT, 'style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(REPO_ROOT, 'app.js'), 'utf8');

// Extracts just the <section class="samples-section" ...> ... </section>
// block so assertions can't accidentally match unrelated markup elsewhere.
function samplesSectionHtml(html) {
  const start = html.indexOf('<section class="samples-section"');
  const end = html.indexOf('</section>', start);
  assert(start !== -1 && end !== -1, 'expected to find the samples-section block');
  return html.slice(start, end);
}

const SAMPLES_HTML = samplesSectionHtml(indexHtml);

function cardBlocks(sectionHtml) {
  const matches = sectionHtml.match(/<article class="sample-card">[\s\S]*?<\/article>/g);
  assert(matches, 'expected to find sample-card <article> blocks');
  return matches;
}

// =====================================================================
// 1. The sample section appears on the login page
// =====================================================================
run('index.html: the samples section appears on the login page (before the main app), with the required copy', () => {
  const mainAppStart = indexHtml.indexOf('MAIN APP');
  const sectionStart = indexHtml.indexOf('<section class="samples-section"');
  assert(sectionStart !== -1 && mainAppStart !== -1 && sectionStart < mainAppStart, 'expected the samples section to be on the login screen, before the main app');
  assert(SAMPLES_HTML.includes('NO SIGN-UP NEEDED'), 'expected the eyebrow copy');
  assert(SAMPLES_HTML.includes("See what your child's next worksheet could look like"), 'expected the exact headline copy');
  assert(SAMPLES_HTML.includes('Printable and interactive worksheets aligned with DepEd MATATAG, with support for diverse learning needs.'), 'expected the exact supporting text');
  assert(SAMPLES_HTML.includes('Preview a few sample worksheets'), 'expected the subheading copy');
});

run('index.html: "unlimited worksheets" is never used anywhere (plans have monthly limits)', () => {
  assert(!/unlimited worksheets/i.test(indexHtml), 'must never claim unlimited worksheets anywhere on the login page');
});

// =====================================================================
// 2-3. Exactly three sample cards, with correct grade/subject/title/details
// =====================================================================
run('index.html: exactly three sample cards are present', () => {
  const cards = cardBlocks(SAMPLES_HTML);
  assert(cards.length === 3, 'expected exactly 3 sample cards, got ' + cards.length);
});

run('index.html: card 1 is Grade 1 Math "Addition with Sums up to 20 - Practice Challenge" (Ann\'s official PDF) with the expected details', () => {
  const card = cardBlocks(SAMPLES_HTML)[0];
  assert(card.includes('>Grade 1<'), 'expected Grade 1 badge');
  assert(card.includes('badge-subject-math') && card.includes('>Math<'), 'expected Math subject badge');
  assert(card.includes('Addition with Sums up to 20 - Practice Challenge'), 'expected the exact learner-facing title from the official PDF');
  assert(/20 items.*With answer key.*Printable/.test(card), 'expected the details line to reflect the real 20-item count printed in the PDF');
});

run('index.html: card 2 is Grade 3 Filipino "Mga Salitang Kilos sa Iba\'t Ibang Aspekto" (Ann\'s official Pandiwa_Reference PDF) with the expected details', () => {
  const card = cardBlocks(SAMPLES_HTML)[1];
  assert(card.includes('>Grade 3<'), 'expected Grade 3 badge');
  assert(card.includes('badge-subject-filipino') && card.includes('>Filipino<'), 'expected Filipino subject badge');
  assert(card.includes("Mga Salitang Kilos sa Iba't Ibang Aspekto"), 'expected the exact learner-facing (sub)title from the official Reference PDF');
  assert(/10 items.*With answer key.*Printable/.test(card), 'expected the details line to reflect the real 10-item count printed in the Reference PDF');
});

run('index.html: card 3 is Grade 5 Science "Motion: Measuring Time and Distance" (Ann\'s official Motion..._Reference PDF), and the old Circulatory System sample is completely gone', () => {
  const card = cardBlocks(SAMPLES_HTML)[2];
  assert(card.includes('>Grade 5<'), 'expected Grade 5 badge');
  assert(card.includes('badge-subject-science') && card.includes('>Science<'), 'expected Science subject badge');
  assert(card.includes('Motion: Measuring Time and Distance'), 'expected the exact learner-facing title from the official PDF');
  assert(/10 items.*With answer key.*Printable/.test(card), 'expected the details line to reflect the real 10-item count printed in the Reference PDF');
  assert(!/Circulatory System/i.test(indexHtml), 'the old Human Body: Circulatory System sample must be completely removed from index.html');
  assert(!/Human Body/i.test(indexHtml), 'the old Human Body sample title must be completely removed from index.html');
});

run('index.html: every card includes a thumbnail, a clear PDF indicator, and Preview/Download actions', () => {
  cardBlocks(SAMPLES_HTML).forEach((card, i) => {
    assert(card.includes('sample-thumb'), 'card ' + i + ' missing the worksheet-style thumbnail');
    assert(/PDF/.test(card), 'card ' + i + ' missing a clear PDF indicator');
    assert(card.includes('sample-btn-preview') && />Preview</.test(card), 'card ' + i + ' missing a Preview action');
    assert(card.includes('sample-btn-download') && /Download Sample/.test(card), 'card ' + i + ' missing a Download Sample action');
  });
});

// =====================================================================
// 4-6. Preview/Download link correctness
// =====================================================================
// The three APPROVED official PDFs Ann placed directly under
// sample_worksheets/ -- referenced from there directly (no duplicate copy
// under a second folder), per the "avoid unnecessary duplicate PDF copies"
// requirement. Filipino and Science were switched to their "_Reference"
// variants per Ann's explicit follow-up instruction; Math is unchanged.
const EXPECTED_PDFS = [
  'sample_worksheets/Addition_with_Sums_up_to_20.pdf',
  'sample_worksheets/Pandiwa_Reference.pdf',
  'sample_worksheets/Motion_Measuring_Time_and_Distance_Reference.pdf'
];

// The non-Reference originals that Filipino/Science used to point at --
// still real, still on disk (Ann's official files), just no longer
// referenced by these two cards specifically.
const SUPERSEDED_OFFICIAL_PDF_PATHS = [
  'sample_worksheets/Pandiwa.pdf',
  'sample_worksheets/Motion_Measuring_Time_and_Distance.pdf'
];

const OLD_GENERATED_PDF_PATHS = [
  'samples/grade1-math-addition-within-20.pdf',
  'samples/grade3-filipino-pandiwa-aspekto.pdf',
  'samples/grade5-science-circulatory-system.pdf'
];

run('index.html: each Preview link points at the expected LOCAL PDF asset, opens in a new tab safely, and requires no login', () => {
  const cards = cardBlocks(SAMPLES_HTML);
  cards.forEach((card, i) => {
    const hrefMatch = card.match(/class="sample-btn sample-btn-preview" href="([^"]+)"/);
    assert(hrefMatch, 'card ' + i + ': expected a Preview link with an href');
    assert(hrefMatch[1] === EXPECTED_PDFS[i], 'card ' + i + ': expected Preview href ' + EXPECTED_PDFS[i] + ', got ' + hrefMatch[1]);
    const previewTag = card.match(/<a class="sample-btn sample-btn-preview"[^>]*>/)[0];
    assert(previewTag.includes('target="_blank"'), 'card ' + i + ': expected target="_blank" on Preview');
    assert(previewTag.includes('rel="noopener"'), 'card ' + i + ': expected rel="noopener" on Preview');
    assert(!/onclick=/.test(previewTag), 'card ' + i + ': Preview must be a plain link, not routed through any JS/auth-gated function');
  });
});

run('index.html: each Download link uses the SAME local PDF as Preview, with a sensible filename and no login requirement', () => {
  const cards = cardBlocks(SAMPLES_HTML);
  const expectedNames = [
    'BrightBridge-Grade1-Math-Addition-with-Sums-up-to-20.pdf',
    'BrightBridge-Grade3-Filipino-Pandiwa.pdf',
    'BrightBridge-Grade5-Science-Motion-Measuring-Time-and-Distance.pdf'
  ];
  cards.forEach((card, i) => {
    const previewHref = card.match(/class="sample-btn sample-btn-preview" href="([^"]+)"/)[1];
    const downloadTag = card.match(/<a class="sample-btn sample-btn-download"[^>]*>/)[0];
    const downloadHrefMatch = downloadTag.match(/href="([^"]+)"/);
    const downloadNameMatch = downloadTag.match(/download="([^"]+)"/);
    assert(downloadHrefMatch && downloadHrefMatch[1] === previewHref, 'card ' + i + ': expected Download to point at the same local PDF as Preview');
    assert(downloadNameMatch && downloadNameMatch[1] === expectedNames[i], 'card ' + i + ': expected a sensible download filename, got ' + (downloadNameMatch && downloadNameMatch[1]));
    assert(!/onclick=/.test(downloadTag), 'card ' + i + ': Download must be a plain link, not routed through any JS/auth-gated function');
  });
});

run('the 3 approved official sample PDFs actually exist on disk under sample_worksheets/ (no broken links)', () => {
  EXPECTED_PDFS.forEach((rel) => {
    const full = path.join(REPO_ROOT, rel);
    assert(fs.existsSync(full), 'expected ' + rel + ' to exist');
    assert(fs.statSync(full).size > 100, 'expected ' + rel + ' to be a real, non-empty PDF file');
  });
});

run('none of the old hand-authored generated sample PDF paths remain anywhere in index.html', () => {
  OLD_GENERATED_PDF_PATHS.forEach((oldPath) => {
    assert(!indexHtml.includes(oldPath), 'expected the old generated path "' + oldPath + '" to be fully removed from index.html');
  });
  assert(!fs.existsSync(path.join(REPO_ROOT, 'samples')), 'expected the old samples/ directory (hand-authored PDFs) to be removed entirely');
});

run('Filipino/Science no longer reference the superseded (non-Reference) official PDFs, which remain on disk untouched', () => {
  SUPERSEDED_OFFICIAL_PDF_PATHS.forEach((supersededPath) => {
    assert(!indexHtml.includes(supersededPath), 'expected "' + supersededPath + '" to no longer be referenced by any card');
    assert(fs.existsSync(path.join(REPO_ROOT, supersededPath)), 'expected Ann\'s original official file "' + supersededPath + '" to remain untouched on disk even though unused');
  });
});

// =====================================================================
// 7. No generation endpoint, quota, or Supabase call is triggered
// =====================================================================
run('index.html: the samples section never references the generation endpoint, quota reservation, or Supabase', () => {
  assert(!/generateWorksheet\(/.test(SAMPLES_HTML), 'must never call generateWorksheet() from the samples section');
  assert(!/\/\.netlify\/functions\//.test(SAMPLES_HTML), 'must never reference the generation/admin function endpoints');
  assert(!/supabase/i.test(SAMPLES_HTML), 'must never reference Supabase from the samples section');
  assert(!/reserve_usage_slot|reserve_provider_retry|finalize_validated_generation/.test(SAMPLES_HTML), 'must never reference quota/reservation RPCs');
});

run('app.js: handleSamplesCta() never calls fetch(), Supabase, or the AI generation function', () => {
  const fnMatch = appJs.match(/function handleSamplesCta\(\) \{[\s\S]*?\n\}/);
  assert(fnMatch, 'expected to find handleSamplesCta() in app.js');
  const body = fnMatch[0];
  assert(!/fetch\(/.test(body), 'handleSamplesCta must never call fetch()');
  assert(!/supabase|db\.auth|db\.from/i.test(body), 'handleSamplesCta must never touch Supabase');
  assert(!/generateWorksheet\(/.test(body), 'handleSamplesCta must never trigger worksheet generation');
});

// =====================================================================
// 8-10. CTA behavior
// =====================================================================
function makeSandbox() {
  const fakeDocument = makeDocument();
  ['authEmail', 'authPassword', 'authHeading', 'authBtn', 'authSub', 'authToggle', 'authMsg',
   'authCard', 'samplesCtaBtn', 'pricingTeaserBtn', 'pricingModalOverlay', 'pricingModal', 'pricingModalCloseBtn'
  ].forEach((id) => fakeDocument.getElementById(id));
  // authMode is a top-level `let` in app.js -- vm.runInContext does not
  // reflect let/const bindings as properties on the context object (only
  // var/function declarations), so a small bridge function is needed to
  // read it, matching the same __test_getState() pattern already used in
  // tests/test_topic_ui.js for topicSource/activeCustomTopic.
  return createAppSandbox({ document: fakeDocument, extraCode: '\nfunction __test_getAuthMode() { return authMode; }\n' });
}

run('handleSamplesCta(): switches the UI to Sign Up mode via the existing toggleAuthMode() behavior', () => {
  const sandbox = makeSandbox();
  assert(sandbox.__test_getAuthMode() === 'login', 'expected the sandbox to start in login mode');
  sandbox.handleSamplesCta();
  assert(sandbox.__test_getAuthMode() === 'signup', 'expected authMode to become signup after the CTA');
  assert(sandbox.document.getElementById('authHeading').textContent === 'Create Your Account', 'expected the signup heading copy');
  assert(sandbox.document.getElementById('authBtn').textContent === 'Create Account', 'expected the signup button copy');
});

run('handleSamplesCta(): does NOT flip back to login mode if already in signup mode (idempotent)', () => {
  const sandbox = makeSandbox();
  sandbox.toggleAuthMode(); // now signup
  sandbox.handleSamplesCta();
  assert(sandbox.__test_getAuthMode() === 'signup', 'expected to remain in signup mode, not toggle back to login');
});

run('handleSamplesCta(): never submits the auth form (no handleAuth()/network call triggered)', () => {
  const sandbox = makeSandbox();
  let authCalled = false;
  sandbox.handleAuth = async () => { authCalled = true; }; // guard: if this were ever invoked, we'd see it
  sandbox.handleSamplesCta();
  assert(!authCalled, 'expected handleSamplesCta to never submit the auth form');
});

run('handleSamplesCta(): smoothly scrolls to the auth card', () => {
  const sandbox = makeSandbox();
  const authCard = sandbox.document.getElementById('authCard');
  let scrollArgs = null;
  authCard.scrollIntoView = (opts) => { scrollArgs = opts; };
  sandbox.handleSamplesCta();
  assert(scrollArgs !== null, 'expected scrollIntoView() to be called on the auth card');
  assert(scrollArgs.behavior === 'smooth', 'expected a smooth scroll, got: ' + JSON.stringify(scrollArgs));
});

run('handleSamplesCta(): moves keyboard focus to the first sign-up field (authEmail)', () => {
  const sandbox = makeSandbox();
  sandbox.handleSamplesCta();
  assert(sandbox.document.activeElement === sandbox.document.getElementById('authEmail'), 'expected focus to move to the email field');
});

// =====================================================================
// 11. Existing Login, Sign Up, and pricing-modal behavior remains unchanged
// =====================================================================
run('REGRESSION: toggleAuthMode() still works standalone, unaffected by the samples section', () => {
  const sandbox = makeSandbox();
  sandbox.toggleAuthMode();
  assert(sandbox.document.getElementById('authHeading').textContent === 'Create Your Account', 'expected toggleAuthMode() to still switch to signup copy');
  sandbox.toggleAuthMode();
  assert(sandbox.document.getElementById('authHeading').textContent === 'Welcome Back', 'expected toggleAuthMode() to still switch back to login copy');
});

run('REGRESSION: the pricing modal still opens/closes correctly alongside the new samples section', () => {
  const sandbox = makeSandbox();
  sandbox.openPricingModal();
  assert(sandbox.document.getElementById('pricingModalOverlay').classList.contains('visible'), 'expected the pricing modal to still open correctly');
  sandbox.closePricingModal();
  assert(!sandbox.document.getElementById('pricingModalOverlay').classList.contains('visible'), 'expected the pricing modal to still close correctly');
});

run('REGRESSION: the pricing teaser button still exists on the login page unaffected', () => {
  assert(/id="pricingTeaserBtn"/.test(indexHtml), 'expected the pricing teaser button to still be present');
});

// =====================================================================
// 12. Responsive CSS rules exist for desktop and mobile
// =====================================================================
run('style.css: desktop shows the 3 cards in one row (grid-template-columns: repeat(3, 1fr))', () => {
  assert(/\.samples-grid\s*{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/.test(styleCss), 'expected a 3-column desktop grid for the sample cards');
});

run('style.css: a mobile/tablet breakpoint collapses the sample cards to a single column', () => {
  assert(/@media \(max-width:\s*900px\)\s*{[^}]*\.samples-grid\s*{[^}]*grid-template-columns:\s*1fr/.test(styleCss), 'expected the samples grid to collapse to 1 column at the mobile breakpoint');
});

// =====================================================================
// 13. No external PDF or image URL is used
// =====================================================================
run('index.html: no external URL is used anywhere in the samples section (PDFs are all local, relative paths)', () => {
  assert(!/https?:\/\//.test(SAMPLES_HTML), 'the samples section must never reference an external URL');
});

console.log('\nDone.');

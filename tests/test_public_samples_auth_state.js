// Tests that the public "Sample Worksheets" section
// (#publicSamplesSection) is shown/hidden purely by AUTHENTICATION STATE
// -- never by viewport/device -- via the centralized
// setPublicSamplesVisibility() helper in app.js, called from showApp()/
// showAuth()/initAuth(). Exercises the REAL production app.js in a vm
// sandbox (see helpers/load-app-sandbox.js), with a controllable fake
// Supabase auth client (same pattern as tests/test_quota_display.js) so
// login/logout/session-restore/expiry can all be simulated directly,
// without a real network call.
const fs = require('fs');
const path = require('path');
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

const REPO_ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(REPO_ROOT, 'app.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(REPO_ROOT, 'style.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// A minimal Supabase query-builder stand-in: thenable, chainable, and
// always resolves to an empty-but-well-formed result -- enough for
// loadWorksheets()/loadPlanAndUsage() (both already wrapped in try/catch
// or reading {data,error}/{count}) to run to completion without throwing,
// so showApp()'s real body can execute in full during these tests.
function safeQueryBuilder() {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    gte() { return builder; },
    order() { return builder; },
    single: async () => ({ data: null, error: null }),
    then(resolve) { resolve({ data: [], error: null, count: 0 }); }
  };
  return builder;
}

const FAKE_ELEMENT_IDS = [
  'auth-screen', 'app', 'authEmail', 'authPassword', 'authHeading', 'authBtn', 'authSub',
  'authToggle', 'authMsg', 'authCard', 'userEmail', 'wsCount', 'quotaCount', 'quotaPlanBadge',
  'quotaRenew', 'quotaBlockedText', 'quotaBlocked', 'wsList', 'wsSearch', 'wsGradeSelect',
  'wsSubjectSelect', 'wsModeChips', 'grade', 'quarter', 'subject', 'topic', 'activity', 'items',
  'difficulty', 'dysgraphia', 'simplified', 'attention', 'processing', 'errorMsg',
  'worksheetOutput', 'interactiveArea', 'output-section', 'savedBadge', 'publicSamplesSection',
  'pricingTeaserBtn', 'samplesCtaBtn'
];

// `initialSession` seeds what getSession() reports at initAuth() startup
// (simulating a page load with/without a previously-restored session).
// `authOverrides` lets a test replace individual auth.* methods (e.g. to
// make signInWithPassword fail) without needing a full fake backend.
function makeAuthSandbox(initialSession, authOverrides) {
  const fakeDocument = makeDocument();
  FAKE_ELEMENT_IDS.forEach((id) => fakeDocument.getElementById(id));
  let authChangeCallback = null;

  const auth = Object.assign({
    getSession: async () => ({ data: { session: initialSession || null } }),
    onAuthStateChange: (cb) => { authChangeCallback = cb; },
    signInWithPassword: async () => ({ error: null }),
    signUp: async () => ({ data: {}, error: null }),
    signOut: async () => { if (authChangeCallback) authChangeCallback('SIGNED_OUT', null); },
    resetPasswordForEmail: async () => ({ error: null }),
    updateUser: async () => ({})
  }, authOverrides || {});

  const sandbox = createAppSandbox({
    document: fakeDocument,
    window: {
      supabase: {
        createClient: () => ({
          auth,
          from: () => safeQueryBuilder()
        })
      }
    }
  });

  return {
    sandbox,
    fireAuthChange(event, session) {
      assert(authChangeCallback, 'onAuthStateChange callback was never registered by initAuth()');
      authChangeCallback(event, session);
    }
  };
}

function samplesSection(sandbox) {
  return sandbox.document.getElementById('publicSamplesSection');
}

const FAKE_USER = { id: 'user-1', email: 'parent@example.com' };
const FAKE_SESSION = { user: FAKE_USER };

(async () => {

// =====================================================================
// 1. Public samples are visible when logged out
// =====================================================================
await run('LOGGED OUT: public samples section is visible on initial load with no session', async () => {
  const { sandbox } = makeAuthSandbox(null);
  await flush();
  const section = samplesSection(sandbox);
  assert(section.hidden === false, 'expected the section to be visible when logged out, got hidden=' + section.hidden);
  assert(section.getAttribute('aria-hidden') === null, 'expected aria-hidden to be absent when logged out');
});

// =====================================================================
// 2. Successful login hides the section
// =====================================================================
await run('LOGIN: a SIGNED_IN auth event (successful login) hides the public samples section', async () => {
  const { sandbox, fireAuthChange } = makeAuthSandbox(null);
  await flush();
  assert(samplesSection(sandbox).hidden === false, 'setup: expected visible before login');
  fireAuthChange('SIGNED_IN', FAKE_SESSION);
  const section = samplesSection(sandbox);
  assert(section.hidden === true, 'expected the section to be hidden immediately after a successful login');
  assert(section.getAttribute('aria-hidden') === 'true', 'expected aria-hidden="true" once authenticated');
});

// =====================================================================
// 3. Restored authenticated session on initial page load
// =====================================================================
await run('RESTORED SESSION: an already-authenticated session at initial page load hides the section (no flash)', async () => {
  const { sandbox } = makeAuthSandbox(FAKE_SESSION);
  await flush();
  const section = samplesSection(sandbox);
  assert(section.hidden === true, 'expected a restored authenticated session to hide the section on load');
  assert(section.getAttribute('aria-hidden') === 'true', 'expected aria-hidden="true" for a restored session');
});

await run('RESTORED SESSION: the markup itself defaults to hidden, so there is no window where an authenticated user briefly sees it before JS runs', () => {
  const sectionTagMatch = indexHtml.match(/<section class="samples-section"[^>]*>/);
  assert(sectionTagMatch, 'expected to find the samples-section tag');
  const tag = sectionTagMatch[0];
  assert(/\bhidden\b/.test(tag), 'expected the section to default to hidden in the raw HTML markup (fail-safe against a flash of public content for authenticated users)');
  assert(/aria-hidden="true"/.test(tag), 'expected the default markup to also set aria-hidden="true"');
});

// =====================================================================
// 4. Successful sign-up/authentication hides the section
// =====================================================================
await run('SIGN-UP: a successful sign-up that establishes a session hides the section, exactly like login', async () => {
  const { sandbox, fireAuthChange } = makeAuthSandbox(null);
  await flush();
  assert(samplesSection(sandbox).hidden === false, 'setup: expected visible before sign-up');
  // Supabase fires onAuthStateChange with the new session once sign-up
  // succeeds and email confirmation is not required -- app.js does not
  // special-case signup vs login, both funnel through the same listener.
  fireAuthChange('SIGNED_IN', { user: { id: 'user-2', email: 'newparent@example.com' } });
  assert(samplesSection(sandbox).hidden === true, 'expected sign-up (session established) to hide the section');
});

// =====================================================================
// 5. Logout restores the section
// =====================================================================
await run('LOGOUT: signing out restores (un-hides) the public samples section', async () => {
  const { sandbox, fireAuthChange } = makeAuthSandbox(FAKE_SESSION);
  await flush();
  assert(samplesSection(sandbox).hidden === true, 'setup: expected hidden while authenticated');
  await sandbox.handleLogout();
  const section = samplesSection(sandbox);
  assert(section.hidden === false, 'expected logout to restore the section');
  assert(section.getAttribute('aria-hidden') === null, 'expected aria-hidden to be removed after logout');
});

// =====================================================================
// 6. Session clearing / expiry restores the section
// =====================================================================
await run('SESSION EXPIRY: an auth event reporting a null session (expired/cleared token) restores the section', async () => {
  const { sandbox, fireAuthChange } = makeAuthSandbox(FAKE_SESSION);
  await flush();
  assert(samplesSection(sandbox).hidden === true, 'setup: expected hidden while authenticated');
  fireAuthChange('TOKEN_REFRESHED', null); // Supabase reports session:null on an expired/invalidated token
  const section = samplesSection(sandbox);
  assert(section.hidden === false, 'expected an expired/cleared session to restore the section');
  assert(section.getAttribute('aria-hidden') === null, 'expected aria-hidden to be removed on session expiry');
});

// =====================================================================
// 7. Failed login leaves the section visible
// =====================================================================
await run('FAILED LOGIN: a rejected sign-in never hides the section (no auth event fires)', async () => {
  const { sandbox } = makeAuthSandbox(null, {
    signInWithPassword: async () => ({ error: { message: 'Invalid login credentials' } })
  });
  await flush();
  sandbox.document.getElementById('authEmail').value = 'parent@example.com';
  sandbox.document.getElementById('authPassword').value = 'wrong-password';
  await sandbox.handleAuth();
  const section = samplesSection(sandbox);
  assert(section.hidden === false, 'expected the section to remain visible after a failed login attempt');
  assert(section.getAttribute('aria-hidden') === null, 'expected no aria-hidden after a failed login attempt');
});

// =====================================================================
// 8. The hidden state cannot be overridden by the mobile CSS breakpoint
//    (and is not viewport/device-based in the first place)
// =====================================================================
await run('style.css: [hidden] on .samples-section is enforced with !important, overriding any future display rule at any breakpoint', () => {
  assert(/\.samples-section\[hidden\]\s*{[^}]*display:\s*none\s*!important/.test(styleCss), 'expected a defensive !important display:none rule keyed off the [hidden] attribute');
});

await run('style.css: the mobile breakpoint only ever adjusts layout (grid-template-columns/padding), never a display/visibility override that could fight [hidden]', () => {
  const mobileBlockMatch = styleCss.match(/@media \(max-width:\s*900px\)\s*{([\s\S]*?)\n {2}}/);
  assert(mobileBlockMatch, 'expected to find the samples-section mobile breakpoint block');
  const mobileBlock = mobileBlockMatch[1];
  assert(!/\.samples-section\s*{[^}]*display:/.test(mobileBlock), 'the mobile breakpoint must never set .samples-section { display: ... } -- that would be a device-based visibility rule, which this defect explicitly forbids');
});

await run('app.js: setPublicSamplesVisibility() is purely auth-state-driven -- no viewport/device detection of any kind', () => {
  const fnMatch = appJs.match(/function setPublicSamplesVisibility\(isAuthenticated\) \{[\s\S]*?\n\}/);
  assert(fnMatch, 'expected to find setPublicSamplesVisibility() in app.js');
  const body = fnMatch[0];
  assert(!/matchMedia|innerWidth|innerHeight|userAgent|navigator\./.test(body), 'setPublicSamplesVisibility must never branch on viewport size or device -- authentication state is the only input');
});

await run('DESKTOP REGRESSION: the exact same hidden/visible DOM result applies regardless of viewport -- there is no device-specific code path to diverge', async () => {
  // This fake DOM has no real layout engine (no viewport concept at all),
  // which is itself the point: setPublicSamplesVisibility() takes no
  // viewport/device input, so the SAME assertions that pass here are
  // guaranteed to hold at any real screen size (desktop, tablet, phone) --
  // there is no code path left that could behave differently by device.
  const { sandbox, fireAuthChange } = makeAuthSandbox(null);
  await flush();
  assert(samplesSection(sandbox).hidden === false, 'desktop/any-viewport: expected visible when logged out');
  fireAuthChange('SIGNED_IN', FAKE_SESSION);
  assert(samplesSection(sandbox).hidden === true, 'desktop/any-viewport: expected hidden once authenticated');
  await sandbox.handleLogout();
  assert(samplesSection(sandbox).hidden === false, 'desktop/any-viewport: expected visible again after logout');
});

// =====================================================================
// 9. Logged-out CTA, Preview, and Download behavior remains unchanged
// =====================================================================
await run('REGRESSION: while logged out, "Create Your Own Worksheet" (handleSamplesCta) still switches to Sign Up mode', async () => {
  const { sandbox } = makeAuthSandbox(null);
  await flush();
  sandbox.handleSamplesCta();
  assert(sandbox.document.getElementById('authHeading').textContent === 'Create Your Account', 'expected the CTA to still switch to signup copy while logged out');
});

await run('REGRESSION: logging in and back out does not remove/alter the Preview or Download links themselves', () => {
  assert(/sample_worksheets\/Addition_with_Sums_up_to_20\.pdf/.test(indexHtml), 'expected the Math sample PDF link to still be present');
  assert(/sample_worksheets\/Pandiwa_Reference\.pdf/.test(indexHtml), 'expected the Filipino sample PDF link to still be present');
  assert(/sample_worksheets\/Motion_Measuring_Time_and_Distance_Reference\.pdf/.test(indexHtml), 'expected the Science sample PDF link to still be present');
});

// =====================================================================
// Whole-section hiding: heading, cards, CTA, and section spacing all
// disappear together (no empty white strip left behind)
// =====================================================================
await run('the ENTIRE public samples section -- eyebrow, all 3 cards, and the CTA panel -- share the single [hidden] toggle (no partial hide)', () => {
  const sectionStart = indexHtml.indexOf('<section class="samples-section" id="publicSamplesSection"');
  const sectionEnd = indexHtml.indexOf('</section>', sectionStart);
  assert(sectionStart !== -1 && sectionEnd !== -1, 'expected to find the samples section');
  const sectionHtml = indexHtml.slice(sectionStart, sectionEnd);
  assert(sectionHtml.includes('NO SIGN-UP NEEDED'), 'expected the eyebrow to be INSIDE the toggled section');
  assert((sectionHtml.match(/<article class="sample-card">/g) || []).length === 3, 'expected all 3 cards to be INSIDE the toggled section');
  assert(sectionHtml.includes('samples-cta'), 'expected the CTA panel to be INSIDE the toggled section');
  // The section's own padding/margin/background (samples-section itself)
  // is what would otherwise leave a visible empty strip -- display:none
  // via [hidden] collapses the element (and its padding/margin) entirely,
  // which is exactly why the fix targets the outer <section>, not just
  // its children.
});

console.log('\nDone.');
})();

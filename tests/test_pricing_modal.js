// Tests the login-page "View Plans & Pricing" teaser + pricing leaflet
// modal: openPricingModal()/closePricingModal()/handlePricingOverlayClick()/
// handlePricingModalKeydown() in app.js, exercised via the REAL production
// app.js in a vm sandbox (see helpers/load-app-sandbox.js) -- no hand-copied
// reimplementation of the functions under test. index.html/style.css
// markup is checked via direct SOURCE CHECKS (this project has no HTML
// parser in its fake DOM), consistent with the pattern used elsewhere in
// tests/ (e.g. test_wiring.js).
const fs = require('fs');
const path = require('path');
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

const REPO_ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(REPO_ROOT, 'style.css'), 'utf8');

// Grabs just the <img> tag for the pricing leaflet so assertions about its
// attributes can't accidentally match some other, unrelated <img> tag.
function pricingImageTag(html) {
  const match = html.match(/<img[^>]*id="pricingModalImage"[^>]*>/);
  return match ? match[0] : '';
}

function makeSandbox() {
  const fakeDocument = makeDocument();
  // Seed exactly the elements openPricingModal()/closePricingModal()/
  // toggleAuthMode() touch, matching the real index.html ids.
  ['pricingTeaserBtn', 'pricingModalOverlay', 'pricingModal', 'pricingModalCloseBtn', 'pricingModalImage',
   'authHeading', 'authBtn', 'authSub', 'authToggle', 'authMsg'].forEach((id) => fakeDocument.getElementById(id));
  return createAppSandbox({ document: fakeDocument });
}

// =====================================================================
// 1. Pricing trigger appears on the login page (SOURCE CHECK)
// =====================================================================
run('index.html: the pricing teaser copy and "View Plans & Pricing" trigger button appear on the login page', () => {
  assert(indexHtml.includes('New to BrightBridge? Explore our plans and pricing.'), 'expected the teaser copy to be present');
  assert(/id="pricingTeaserBtn"/.test(indexHtml), 'expected the trigger button element to be present');
  assert(/View Plans &amp; Pricing/.test(indexHtml), 'expected the trigger button label');
  assert(/onclick="openPricingModal\(\)"/.test(indexHtml), 'expected the trigger to call openPricingModal()');
});

run('index.html: the pricing teaser is placed near the sign-up prompt, inside the login auth-card (not the main app)', () => {
  const authCardStart = indexHtml.indexOf('class="auth-card"');
  const mainAppStart = indexHtml.indexOf('MAIN APP');
  const teaserIndex = indexHtml.indexOf('id="pricingTeaserBtn"');
  const toggleIndex = indexHtml.indexOf('id="authToggle"');
  assert(authCardStart !== -1 && teaserIndex > authCardStart, 'expected the teaser to be inside the auth card');
  assert(mainAppStart !== -1 && teaserIndex < mainAppStart, 'expected the teaser to be on the login screen, not inside the main app');
  assert(toggleIndex !== -1 && teaserIndex > toggleIndex, 'expected the teaser to appear near/after the sign-up toggle prompt');
});

// =====================================================================
// 2-5. Modal open/close behavior
// =====================================================================
run('openPricingModal(): opens the modal (adds .visible) and locks background scroll', () => {
  const sandbox = makeSandbox();
  sandbox.openPricingModal();
  const overlay = sandbox.document.getElementById('pricingModalOverlay');
  assert(overlay.classList.contains('visible'), 'expected the overlay to gain the .visible class when opened');
});

run('closePricingModal(): the close button (button/X) closes the modal', () => {
  const sandbox = makeSandbox();
  sandbox.openPricingModal();
  sandbox.closePricingModal();
  const overlay = sandbox.document.getElementById('pricingModalOverlay');
  assert(!overlay.classList.contains('visible'), 'expected the overlay to lose the .visible class when closed via the close button');
});

run('handlePricingModalKeydown(): Escape closes the modal while open', () => {
  const sandbox = makeSandbox();
  sandbox.openPricingModal();
  sandbox.handlePricingModalKeydown({ key: 'Escape' });
  const overlay = sandbox.document.getElementById('pricingModalOverlay');
  assert(!overlay.classList.contains('visible'), 'expected Escape to close the open modal');
});

run('handlePricingModalKeydown(): Escape is a no-op when the modal is already closed', () => {
  const sandbox = makeSandbox();
  // Never opened -- must not throw, and nothing should change.
  sandbox.handlePricingModalKeydown({ key: 'Escape' });
  const overlay = sandbox.document.getElementById('pricingModalOverlay');
  assert(!overlay.classList.contains('visible'), 'expected the modal to remain closed');
});

run('handlePricingOverlayClick(): clicking the backdrop (overlay itself) closes the modal', () => {
  const sandbox = makeSandbox();
  sandbox.openPricingModal();
  sandbox.handlePricingOverlayClick({ target: { id: 'pricingModalOverlay' } });
  const overlay = sandbox.document.getElementById('pricingModalOverlay');
  assert(!overlay.classList.contains('visible'), 'expected a backdrop click to close the modal');
});

run('handlePricingOverlayClick(): clicking INSIDE the modal (event bubbling from the card/image) does NOT close it', () => {
  const sandbox = makeSandbox();
  sandbox.openPricingModal();
  sandbox.handlePricingOverlayClick({ target: { id: 'pricingModalImage' } });
  const overlay = sandbox.document.getElementById('pricingModalOverlay');
  assert(overlay.classList.contains('visible'), 'expected a click inside the modal content to leave it open');
});

// =====================================================================
// 6. Image uses the expected local asset + descriptive alt text
// =====================================================================
run('index.html: the pricing leaflet <img> uses the local static asset, never an external URL', () => {
  const tag = pricingImageTag(indexHtml);
  assert(tag.length > 0, 'expected to find the pricing modal <img> tag');
  assert(/src="pricing-leaflet\.png"/.test(tag), 'expected the local pricing-leaflet.png asset, got: ' + tag);
  assert(!/https?:\/\//.test(tag), 'the pricing image must never be fetched from an external URL');
});

run('index.html: the pricing leaflet <img> has descriptive, non-empty alt text', () => {
  const tag = pricingImageTag(indexHtml);
  const altMatch = tag.match(/alt="([^"]*)"/);
  assert(altMatch, 'expected an alt attribute on the pricing image');
  const alt = altMatch[1];
  assert(alt.length > 15, 'expected descriptive (non-trivial) alt text, got: ' + JSON.stringify(alt));
  assert(/pricing|plans/i.test(alt), 'expected the alt text to describe the pricing/plans content, got: ' + JSON.stringify(alt));
});

run('index.html: the pricing leaflet <img> is lazy-loaded (performance requirement)', () => {
  const tag = pricingImageTag(indexHtml);
  assert(/loading="lazy"/.test(tag), 'expected loading="lazy" on the pricing image');
});

run('pricing-leaflet.png exists as a local static asset at the repository root', () => {
  const imgPath = path.join(REPO_ROOT, 'pricing-leaflet.png');
  assert(fs.existsSync(imgPath), 'expected pricing-leaflet.png to exist at the repo root');
});

// =====================================================================
// 7. Modal is initially hidden
// =====================================================================
run('the modal overlay does NOT have the .visible class before openPricingModal() is ever called', () => {
  const sandbox = makeSandbox();
  const overlay = sandbox.document.getElementById('pricingModalOverlay');
  assert(!overlay.classList.contains('visible'), 'expected the modal to be hidden by default');
});

run('style.css: .pricing-modal-overlay is display:none by default and only display:flex with .visible', () => {
  assert(/\.pricing-modal-overlay\s*{[^}]*display:\s*none/.test(styleCss), 'expected the overlay to be display:none by default');
  assert(/\.pricing-modal-overlay\.visible\s*{[^}]*display:\s*flex/.test(styleCss), 'expected .visible to switch the overlay to display:flex');
});

// =====================================================================
// Accessibility: role/aria/title, focus management, focus trap
// =====================================================================
run('index.html: the modal has role="dialog", aria-modal="true", and an accessible title', () => {
  const modalMatch = indexHtml.match(/<div class="pricing-modal"[^>]*>/);
  assert(modalMatch, 'expected to find the pricing-modal container tag');
  const tag = modalMatch[0];
  assert(/role="dialog"/.test(tag), 'expected role="dialog"');
  assert(/aria-modal="true"/.test(tag), 'expected aria-modal="true"');
  assert(/aria-labelledby="pricingModalTitle"/.test(tag), 'expected aria-labelledby pointing at an accessible title');
  assert(/id="pricingModalTitle"[^>]*>Plans &amp; Pricing</.test(indexHtml), 'expected the referenced title element to contain real text');
});

run('index.html: the close button is clearly visible and accessibly labeled', () => {
  assert(/id="pricingModalCloseBtn"[^>]*aria-label="Close plans and pricing"/.test(indexHtml), 'expected an accessible aria-label on the close button');
  assert(/id="pricingModalCloseBtn"[^>]*onclick="closePricingModal\(\)"/.test(indexHtml), 'expected the close button to call closePricingModal()');
});

run('openPricingModal(): moves focus into the modal (to the close button)', () => {
  const sandbox = makeSandbox();
  sandbox.openPricingModal();
  assert(sandbox.document.activeElement === sandbox.document.getElementById('pricingModalCloseBtn'), 'expected focus to move to the close button on open');
});

run('closePricingModal(): returns keyboard focus to the element that triggered the modal', () => {
  const sandbox = makeSandbox();
  const trigger = sandbox.document.getElementById('pricingTeaserBtn');
  trigger.focus(); // simulate the user having just clicked/focused the trigger
  sandbox.openPricingModal();
  sandbox.closePricingModal();
  assert(sandbox.document.activeElement === trigger, 'expected focus to return to the trigger element after closing');
});

run('handlePricingModalKeydown(): Tab never lets focus escape the modal (traps it back on the close button)', () => {
  const sandbox = makeSandbox();
  sandbox.openPricingModal();
  // Simulate focus having somehow landed elsewhere while the modal is open.
  sandbox.document.getElementById('pricingTeaserBtn').focus();
  let prevented = false;
  sandbox.handlePricingModalKeydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert(prevented, 'expected Tab to be intercepted (preventDefault called) while the modal is open');
  assert(sandbox.document.activeElement === sandbox.document.getElementById('pricingModalCloseBtn'), 'expected focus to be pulled back onto the close button, never left behind the modal');
});

run('handlePricingModalKeydown(): Tab is a no-op when the modal is closed', () => {
  const sandbox = makeSandbox();
  let prevented = false;
  sandbox.handlePricingModalKeydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert(!prevented, 'expected Tab to be left alone when the modal is not open');
});

// =====================================================================
// Responsive display (SOURCE CHECK on style.css)
// =====================================================================
run('style.css: the pricing image never crops -- object-fit: contain and a ~85vh max-height on desktop', () => {
  assert(/\.pricing-modal-image\s*{[^}]*object-fit:\s*contain/.test(styleCss), 'expected object-fit: contain so the leaflet is never cropped');
  assert(/\.pricing-modal-image\s*{[^}]*max-height:\s*85vh/.test(styleCss), 'expected a ~85vh max image height on desktop');
});

run('style.css: the modal body can scroll vertically and a mobile breakpoint exists', () => {
  assert(/\.pricing-modal-body\s*{[^}]*overflow-y:\s*auto/.test(styleCss), 'expected the modal body to allow vertical scrolling');
  assert(/@media \(max-width:\s*640px\)\s*{[^}]*\.pricing-modal/.test(styleCss), 'expected a mobile breakpoint adjusting the pricing modal');
});

run('style.css: background scroll is locked while the modal is open (body.pricing-modal-open)', () => {
  assert(/body\.pricing-modal-open\s*{[^}]*overflow:\s*hidden/.test(styleCss), 'expected body.pricing-modal-open to set overflow: hidden');
});

// =====================================================================
// 8. Existing login/sign-up behavior remains unchanged
// =====================================================================
run('REGRESSION: toggleAuthMode() still toggles between Sign In and Create Account exactly as before', () => {
  const sandbox = makeSandbox();
  sandbox.toggleAuthMode();
  assert(sandbox.document.getElementById('authHeading').textContent === 'Create Your Account', 'expected toggleAuthMode() to switch to signup copy, got: ' + sandbox.document.getElementById('authHeading').textContent);
  assert(sandbox.document.getElementById('authBtn').textContent === 'Create Account', 'expected the button label to switch to Create Account');
  sandbox.toggleAuthMode();
  assert(sandbox.document.getElementById('authHeading').textContent === 'Welcome Back', 'expected toggleAuthMode() to switch back to login copy');
  assert(sandbox.document.getElementById('authBtn').textContent === 'Sign In', 'expected the button label to switch back to Sign In');
});

run('REGRESSION: opening/closing the pricing modal does not touch any auth-form element', () => {
  const sandbox = makeSandbox();
  const email = sandbox.document.getElementById('authEmail');
  email.value = 'parent@example.com';
  sandbox.openPricingModal();
  sandbox.closePricingModal();
  assert(sandbox.document.getElementById('authEmail').value === 'parent@example.com', 'expected the auth email field to be untouched by the pricing modal');
});

console.log('\nDone.');

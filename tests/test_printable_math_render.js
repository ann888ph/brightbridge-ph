// Behavioral test for buildPrintableMathHtml() in app.js: verifies the
// rendering clarification from the architecture approval -- open-response
// by default, MC choices only when explicitly requested, clean answer key
// from final_answer only, dysgraphia formatting preserved, non-Math/print
// CSS classes untouched. Loads the REAL app.js/style.css via the shared
// helper -- no hand-copied source.
const fs = require('fs');
const { repoPath, readAppJsSource, createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

const appJsSource = readAppJsSource();
const styleCss = fs.readFileSync(repoPath('style.css'), 'utf8');

const sandbox = createAppSandbox({
  document: makeDocument(),
  extraCode: `
function __test_buildPrintableMathHtml(quiz, opts) { return buildPrintableMathHtml(quiz, opts); }
`
});

const sampleQuiz = {
  title: 'Money Word Problems',
  directions: 'Solve each problem. Show your work.',
  questions: [
    {
      type: 'multiple_choice',
      question: 'Maria buys 2.5 kg of chicken and 3 kg of pork...',
      solution_steps: '2.5*120=300; 3*95=285; 300+285=585; Actually, let me recalculate... 585',
      final_answer: String.fromCharCode(0x20B1) + '585.00',
      choices: [String.fromCharCode(0x20B1) + '585.00', String.fromCharCode(0x20B1) + '580.00', String.fromCharCode(0x20B1) + '590.00', String.fromCharCode(0x20B1) + '600.00'],
      answer: 0
    },
    {
      type: 'multiple_choice',
      question: 'What is 12 + 8?',
      solution_steps: '12+8=20',
      final_answer: '20',
      choices: ['18', '19', '20', '21'],
      answer: 2
    }
  ]
};

run('Open-response (non-MC activity): choices are NOT rendered on the page', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: false });
  assert(!/585\.00.*580\.00|A\.\s*.*B\.\s*/s.test(html) || !html.includes('B. '), 'expected no A/B/C/D choice rendering for a non-MC activity');
  assert(html.includes('Show your work'), 'expected an open work-space area');
  assert(html.includes('Answer: '), 'expected a plain answer blank in standard (non-dysgraphia) mode');
});

run('Open-response: answer key comes ONLY from final_answer, for every question', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: false });
  assert(html.includes('1. ' + String.fromCharCode(0x20B1) + '585.00'), 'expected Q1 key to be the exact final_answer value');
  assert(html.includes('2. 20'), 'expected Q2 key to be the exact final_answer value');
});

run('solution_steps and self-correction narration NEVER appear in the rendered HTML', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: false });
  assert(!html.includes('recalculate'), 'leaked self-correction narration into printable HTML');
  assert(!html.includes('2.5*120'), 'leaked raw solution_steps arithmetic into printable HTML');
});

run('No separate model-authored answer-key section: exactly one <div class="answer-key">, built by us', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: false });
  const matches = html.match(/class="answer-key"/g) || [];
  assert(matches.length === 1, 'expected exactly one answer-key div, got ' + matches.length);
});

run('Multiple Choice Quiz activity: choices ARE rendered as A/B/C/D', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: true });
  assert(html.includes('A. ') && html.includes('B. ') && html.includes('C. ') && html.includes('D. '), 'expected A/B/C/D choice rendering for an explicit Multiple Choice Quiz activity');
});

run('Dysgraphia mode + Multiple Choice: renders checkbox squares, not lettered blanks', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: true });
  assert(html.includes('&#9744;'), 'expected checkbox glyphs in dysgraphia MC mode');
});

run('Dysgraphia mode + open-response: larger spacing and a boxed Final Answer line', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: false });
  assert(html.includes('Final Answer:'), 'expected a distinct Final Answer label in dysgraphia open-response mode');
  assert(html.includes('line-height:2.4'), 'expected larger line spacing in dysgraphia mode');
});

// ---------------------------------------------------------------------
// Visual-structure regression tests: the Dysgraphia checkbox complaint was
// only ever a small piece of the actual bug -- the real gap was that Math
// never got the same per-question block/card, generous spacing, and
// stacked (non-inline) choice layout that dysgraphia-friendly Printable
// worksheets need. These check the STRUCTURE, not just glyph presence.
// ---------------------------------------------------------------------

run('VISUAL STRUCTURE: dysgraphia mode wraps EVERY question in its own item block (one per question, not shared)', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: true });
  const blockCount = (html.match(/class="dysgraphia-item"/g) || []).length;
  assert(blockCount === sampleQuiz.questions.length, `expected ${sampleQuiz.questions.length} per-question dysgraphia item blocks, got ${blockCount}`);
});

run('VISUAL STRUCTURE: dysgraphia + Multiple Choice renders choices NON-INLINE (each on its own line, not joined by inline spacing)', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: true });
  assert(!html.includes('&#9744;')  || !html.match(/&#9744;[^<]*<\/p>&nbsp;&nbsp;&nbsp;&#9744;/), 'choices must not be joined by an inline nbsp separator in dysgraphia mode');
  // Each choice should be its own <p> inside a dedicated choices wrapper --
  // for 2 questions x 4 choices each, expect 8 individual choice <p> tags.
  const choiceParagraphs = (html.match(/<p style="margin:10px 0/g) || []).length;
  assert(choiceParagraphs === 8, `expected one <p> per choice (8 total across both questions), got ${choiceParagraphs}`);
  assert(html.includes('class="dysgraphia-choices"'), 'expected a dedicated dysgraphia-choices wrapper');
});

run('VISUAL STRUCTURE: dysgraphia + open-response includes a dedicated, visually boxed Final Answer area', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: false });
  assert(html.includes('class="dysgraphia-final-answer"'), 'expected a dedicated, distinctly classed Final Answer box in dysgraphia open-response mode');
  assert(html.includes('Show your work'), 'expected a dedicated work-space area alongside the final answer box');
});

run('VISUAL STRUCTURE: dysgraphia classes/spacing styles are present when dysgraphia is requested (MC and open-response both)', () => {
  const htmlMc = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: true });
  const htmlOpen = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: false });
  assert(htmlMc.includes('class="dysgraphia-item"') && htmlMc.includes('line-height:1.9'), 'expected dysgraphia item block + larger line-height for MC');
  assert(htmlOpen.includes('class="dysgraphia-item"') && htmlOpen.includes('line-height:1.9'), 'expected dysgraphia item block + larger line-height for open-response');
});

run('STYLE SOURCE: every dysgraphia class carries its own inline style attribute (style.css defines none of them, so none may be a bare/unstyled hook)', () => {
  assert(!/dysgraphia/.test(styleCss), 'style.css must have no rules for these classes -- the renderer must be fully self-contained (per design, verify this stays true)');
  const htmlMc = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: true });
  const htmlOpen = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: false });
  assert(/class="dysgraphia-item" style="[^"]+"/.test(htmlMc), 'dysgraphia-item must carry its own inline style, not rely on style.css');
  assert(/class="dysgraphia-choices" style="[^"]+"/.test(htmlMc), 'dysgraphia-choices must carry its own inline style (not just styled children) -- it was previously a bare unstyled wrapper');
  assert(/class="dysgraphia-final-answer" style="[^"]+"/.test(htmlOpen), 'dysgraphia-final-answer must carry its own inline style, not rely on style.css');
});

run('PRINT PAGINATION: every dysgraphia question block sets break-inside and page-break-inside to avoid splitting across a printed page', () => {
  const htmlMc = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: true });
  const htmlOpen = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: true, isMultipleChoice: false });
  [htmlMc, htmlOpen].forEach((html) => {
    const itemBlocks = html.match(/<div class="dysgraphia-item" style="[^"]*"/g) || [];
    assert(itemBlocks.length === sampleQuiz.questions.length, `expected a style-bearing item block per question, got ${itemBlocks.length}`);
    itemBlocks.forEach((block) => {
      assert(block.includes('break-inside:avoid'), 'expected break-inside:avoid on every dysgraphia item block');
      assert(block.includes('page-break-inside:avoid'), 'expected page-break-inside:avoid on every dysgraphia item block (older engine fallback)');
    });
  });
});

run('PRINT PAGINATION: standard (non-dysgraphia) mode never adds pagination rules (no dysgraphia-item block exists to attach them to)', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: true });
  assert(!html.includes('break-inside'), 'standard mode should not include break-inside at all');
  assert(!html.includes('page-break-inside'), 'standard mode should not include page-break-inside at all');
});

run('VISUAL STRUCTURE: standard (non-dysgraphia) mode receives NONE of the dysgraphia layout, in either activity type', () => {
  const htmlMc = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: true });
  const htmlOpen = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: false });
  ['dysgraphia-item', 'dysgraphia-choices', 'dysgraphia-final-answer'].forEach((cls) => {
    assert(!htmlMc.includes(cls), `standard MC mode must not include ${cls}`);
    assert(!htmlOpen.includes(cls), `standard open-response mode must not include ${cls}`);
  });
  assert(!htmlMc.includes('&#9744;'), 'standard MC mode must not render dysgraphia checkboxes');
  assert(!htmlOpen.includes('Final Answer:'), 'standard open-response mode must not render the dysgraphia Final Answer label');
});

run('Output reuses existing .worksheet-output-compatible tags only (h1, p, hr, answer-key div) -- no new CSS needed', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: false });
  assert(/<h1>/.test(html), 'expected an <h1> title, matching every other printable subject');
  assert(/<div class="answer-key">/.test(html), 'expected the same .answer-key class the non-Math printable prompt already uses');
});

// ---------------------------------------------------------------------
// XSS / HTML-injection payload tests: every model-generated field must
// render as harmless visible text only. If any of these ever start
// matching the RAW (unescaped) branch, a malicious or malformed model
// response could inject live markup into a parent's browser.
// ---------------------------------------------------------------------
const PAYLOADS = {
  scriptTag: '<script>alert(1)</script>',
  imgOnerror: '<img src=x onerror=alert(1)>',
  ltAmpGt: '5 < 7 & 8 > 3',
  quotes: '"quoted" and \'quoted\''
};

function assertNeverRaw(html, payload, fieldLabel) {
  // The payload's own text (e.g. the word "onerror=") is EXPECTED to still
  // be visible -- that's "harmless visible text". What must never happen is
  // an unescaped '<' or '>' reaching the output, which is what would let a
  // browser parse it as a real tag instead of inert text.
  assert(!html.includes(payload), `${fieldLabel}: raw unescaped payload leaked into HTML verbatim: ${payload}`);
  assert(!/<script[\s>]/i.test(html), `${fieldLabel}: a live, parseable <script> tag reached the HTML output`);
  assert(!/<img\b/i.test(html), `${fieldLabel}: a live, parseable <img> tag reached the HTML output`);
  if (/[<>]/.test(payload)) {
    assert(html.includes('&lt;') || html.includes('&gt;'), `${fieldLabel}: expected the payload's '<'/'>' to be entity-escaped, found neither &lt; nor &gt;`);
  }
}

Object.keys(PAYLOADS).forEach((key) => {
  const payload = PAYLOADS[key];

  run(`XSS payload [${key}] in title renders as harmless text only`, () => {
    const quiz = { title: payload, directions: 'd', questions: [{ type: 'multiple_choice', question: 'q', final_answer: 'a', choices: ['a', 'b', 'c', 'd'] }] };
    const html = sandbox.__test_buildPrintableMathHtml(quiz, { dysgraphia: false, isMultipleChoice: false });
    assertNeverRaw(html, payload, 'title');
  });

  run(`XSS payload [${key}] in directions renders as harmless text only`, () => {
    const quiz = { title: 't', directions: payload, questions: [{ type: 'multiple_choice', question: 'q', final_answer: 'a', choices: ['a', 'b', 'c', 'd'] }] };
    const html = sandbox.__test_buildPrintableMathHtml(quiz, { dysgraphia: false, isMultipleChoice: false });
    assertNeverRaw(html, payload, 'directions');
  });

  run(`XSS payload [${key}] in passage renders as harmless text only`, () => {
    const quiz = { title: 't', directions: 'd', passage: payload, questions: [{ type: 'multiple_choice', question: 'q', final_answer: 'a', choices: ['a', 'b', 'c', 'd'] }] };
    const html = sandbox.__test_buildPrintableMathHtml(quiz, { dysgraphia: false, isMultipleChoice: false });
    assertNeverRaw(html, payload, 'passage');
  });

  run(`XSS payload [${key}] in question text renders as harmless text only`, () => {
    const quiz = { title: 't', directions: 'd', questions: [{ type: 'multiple_choice', question: payload, final_answer: 'a', choices: ['a', 'b', 'c', 'd'] }] };
    const html = sandbox.__test_buildPrintableMathHtml(quiz, { dysgraphia: false, isMultipleChoice: false });
    assertNeverRaw(html, payload, 'question');
  });

  run(`XSS payload [${key}] in a choice renders as harmless text only (Multiple Choice Quiz activity)`, () => {
    const quiz = { title: 't', directions: 'd', questions: [{ type: 'multiple_choice', question: 'q', final_answer: 'a', choices: [payload, 'b', 'c', 'd'] }] };
    const html = sandbox.__test_buildPrintableMathHtml(quiz, { dysgraphia: false, isMultipleChoice: true });
    assertNeverRaw(html, payload, 'choices');
  });

  run(`XSS payload [${key}] in final_answer renders as harmless text only (inside the answer key)`, () => {
    const quiz = { title: 't', directions: 'd', questions: [{ type: 'multiple_choice', question: 'q', final_answer: payload, choices: ['a', 'b', 'c', 'd'] }] };
    const html = sandbox.__test_buildPrintableMathHtml(quiz, { dysgraphia: false, isMultipleChoice: false });
    assertNeverRaw(html, payload, 'final_answer');
  });

  run(`XSS payload [${key}] in solution_steps NEVER appears at all (field is never read by the renderer)`, () => {
    const quiz = { title: 't', directions: 'd', questions: [{ type: 'multiple_choice', question: 'q', solution_steps: payload, final_answer: 'a', choices: ['a', 'b', 'c', 'd'] }] };
    const html = sandbox.__test_buildPrintableMathHtml(quiz, { dysgraphia: false, isMultipleChoice: false });
    assert(!html.includes(payload), 'solution_steps payload leaked into HTML even though this field should never be read');
    // Also assert the field's plain substring (works for the non-tag payloads
    // too) is absent, since solution_steps must have NO path into the output
    // at all -- not merely an escaped one.
    const plainMarker = payload.replace(/[<>]/g, '');
    if (plainMarker.length > 3) {
      assert(!html.includes(plainMarker), 'solution_steps content (even de-tagged) leaked into HTML');
    }
  });
});

// These inspect app.js's ACTUAL source (not a re-implementation in the test)
// to confirm the call site really does exact equality against the known
// dropdown value, not a substring/regex test that a crafted or coincidental
// activity name (e.g. "Multiple Choice Quiz (Extra Credit)", or an
// unrelated activity that merely mentions "multiple choice" in passing)
// could wrongly satisfy.
run('SOURCE CHECK: the printable-Math call site uses EXACT equality against the known activity value', () => {
  assert(appJsSource.includes("activity === 'Multiple Choice Quiz'"), 'expected an exact-equality check against the literal index.html <option> value');
});

run('SOURCE CHECK: the old loose substring/regex activity match is gone', () => {
  assert(!/\/multiple choice\/i\.test\(activity\)/.test(appJsSource), 'expected the old loose regex match to have been replaced, not left alongside the exact check');
});

run('buildPrintableMathHtml itself is match-strategy-agnostic: given isMultipleChoice=true it renders choices regardless of caller logic', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: true });
  assert(html.includes('A. '), 'expected MC rendering when the caller passes isMultipleChoice: true');
});

run('buildPrintableMathHtml itself is match-strategy-agnostic: given isMultipleChoice=false it never renders choices', () => {
  const html = sandbox.__test_buildPrintableMathHtml(sampleQuiz, { dysgraphia: false, isMultipleChoice: false });
  assert(!html.includes('A. '), 'expected NO MC rendering when the caller passes isMultipleChoice: false');
});

run('SOURCE CHECK: buildPrintableMathHtml never reads solution_steps anywhere in its body (not merely absent from this test\'s output)', () => {
  // Stable named-function boundary, not a fixed line number: finds the
  // function by its declaration text and ends at the NEXT top-level
  // `function` declaration. Fails loudly if either boundary can't be found,
  // rather than silently extracting the wrong range.
  const lines = appJsSource.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('function buildPrintableMathHtml('));
  assert(startIdx !== -1, 'could not locate buildPrintableMathHtml in app.js source for inspection -- has it been renamed or restructured?');
  const endIdx = lines.findIndex((l, i) => i > startIdx && /^function \w+\(/.test(l));
  assert(endIdx !== -1, 'could not locate the next top-level function after buildPrintableMathHtml -- boundary detection may be broken');
  const body = lines.slice(startIdx, endIdx).join('\n');
  assert(!body.includes('solution_steps'), 'buildPrintableMathHtml\'s source body references solution_steps -- it must never read this field at all');
});

console.log('\nDone.');

// Behavioral test for buildPrintableMathHtml() in app.js: verifies the
// per-Activity-Type rendering profile -- deterministic directions (never
// quiz.directions), choices only for Multiple Choice Quiz (keyed off
// q.type, which now matches the requested/validated schema one-to-one), a
// dedicated Matching Type answer bank + answer key, a renderer-owned
// Parent/Tutor Guide, clean answer key from final_answer only, dysgraphia
// formatting preserved, non-Math/print CSS classes untouched. Loads the
// REAL app.js/style.css via the shared helper -- no hand-copied source.
const fs = require('fs');
const { repoPath, readAppJsSource, createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

const appJsSource = readAppJsSource();
const styleCss = fs.readFileSync(repoPath('style.css'), 'utf8');
const PHP = String.fromCharCode(0x20B1);

const sandbox = createAppSandbox({
  document: makeDocument(),
  extraCode: `
function __test_buildPrintableMathHtml(quiz, opts) { return buildPrintableMathHtml(quiz, opts); }
`
});

function build(quiz, opts) {
  return sandbox.__test_buildPrintableMathHtml(quiz, opts);
}

// A payload placed in quiz.directions must NEVER reach the rendered HTML --
// directions are renderer-owned for Math (see MATH_DIRECTIONS_BY_ACTIVITY).
const IGNORED_MODEL_DIRECTIONS = 'MODEL-AUTHORED DIRECTIONS THAT SHOULD NEVER APPEAR';

const mcQuiz = {
  title: 'Money Word Problems',
  directions: IGNORED_MODEL_DIRECTIONS,
  questions: [
    {
      type: 'multiple_choice',
      question: 'Maria buys 2.5 kg of chicken and 3 kg of pork...',
      solution_steps: '2.5*120=300; 3*95=285; 300+285=585; Actually, let me recalculate... 585',
      final_answer: PHP + '585.00',
      choices: [PHP + '585.00', PHP + '580.00', PHP + '590.00', PHP + '600.00'],
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

const worksheetQuiz = {
  title: 'Addition Practice',
  directions: IGNORED_MODEL_DIRECTIONS,
  questions: [
    { type: 'open_response', question: 'What is 5 + 7?', solution_steps: '5+7=12', final_answer: '12' },
    { type: 'open_response', question: 'What is 9 + 6?', solution_steps: '9+6=15', final_answer: '15' }
  ]
};

const readingComprehensionQuiz = {
  title: 'Filipino Recipes',
  directions: IGNORED_MODEL_DIRECTIONS,
  passage: 'Nena has 1/2 cup of sugar and 2 cups of flour for her recipe.',
  questions: [
    {
      type: 'open_response',
      question: 'How much sugar does Nena have, in decimal form?',
      solution_steps: '1/2 = 0.5',
      final_answer: '0.5',
      passage_evidence: '1/2 cup of sugar'
    }
  ]
};

// Deliberately already "sorted" (ascending, matching question order) --
// proves the answer bank is a guaranteed left-rotate-by-one, not a sort
// that could coincidentally reproduce question order.
const matchingQuiz = {
  title: 'Fractions Matching',
  directions: IGNORED_MODEL_DIRECTIONS,
  questions: [
    { type: 'open_response', question: 'Q1', solution_steps: 'x=10', final_answer: '10' },
    { type: 'open_response', question: 'Q2', solution_steps: 'x=20', final_answer: '20' },
    { type: 'open_response', question: 'Q3', solution_steps: 'x=30', final_answer: '30' },
    { type: 'open_response', question: 'Q4', solution_steps: 'x=40', final_answer: '40' },
    { type: 'open_response', question: 'Q5', solution_steps: 'x=50', final_answer: '50' }
  ]
};

const parentTutorQuiz = {
  title: 'Word Problems',
  directions: IGNORED_MODEL_DIRECTIONS,
  questions: [
    { type: 'open_response', question: 'What is 5 x 3?', solution_steps: '5*3=15', final_answer: '15' }
  ]
};

// ---------------------------------------------------------------------
// Multiple Choice Quiz
// ---------------------------------------------------------------------
run('Multiple Choice Quiz: deterministic directions mention choosing an answer (never quiz.directions)', () => {
  const html = build(mcQuiz, { dysgraphia: false, activity: 'Multiple Choice Quiz' });
  assert(!html.includes(IGNORED_MODEL_DIRECTIONS), 'model-authored directions must never appear');
  assert(/choose the correct answer/i.test(html), 'expected deterministic MCQ directions');
});

run('Multiple Choice Quiz: 4 choices rendered as A/B/C/D', () => {
  const html = build(mcQuiz, { dysgraphia: false, activity: 'Multiple Choice Quiz' });
  assert(html.includes('A. ') && html.includes('B. ') && html.includes('C. ') && html.includes('D. '), 'expected A/B/C/D choice rendering');
});

run('Multiple Choice Quiz: answer key comes ONLY from final_answer', () => {
  const html = build(mcQuiz, { dysgraphia: false, activity: 'Multiple Choice Quiz' });
  assert(html.includes('1. ' + PHP + '585.00'), 'expected Q1 key to be the exact final_answer value');
  assert(html.includes('2. 20'), 'expected Q2 key to be the exact final_answer value');
});

run('Multiple Choice Quiz: solution_steps and self-correction narration NEVER appear', () => {
  const html = build(mcQuiz, { dysgraphia: false, activity: 'Multiple Choice Quiz' });
  assert(!html.includes('recalculate'), 'leaked self-correction narration into printable HTML');
  assert(!html.includes('2.5*120'), 'leaked raw solution_steps arithmetic into printable HTML');
});

run('Multiple Choice Quiz + Dysgraphia: renders checkbox squares, not lettered blanks', () => {
  const html = build(mcQuiz, { dysgraphia: true, activity: 'Multiple Choice Quiz' });
  assert(html.includes('&#9744;'), 'expected checkbox glyphs in dysgraphia MC mode');
  assert(html.includes('class="dysgraphia-item"'), 'expected dysgraphia item block');
});

// ---------------------------------------------------------------------
// Worksheet (open_response)
// ---------------------------------------------------------------------
run('Worksheet: deterministic directions never mention choices (never quiz.directions)', () => {
  const html = build(worksheetQuiz, { dysgraphia: false, activity: 'Worksheet' });
  assert(!html.includes(IGNORED_MODEL_DIRECTIONS), 'model-authored directions must never appear');
  assert(!/choice/i.test(html.match(/<strong>Directions:<\/strong>[^<]*/)[0]), 'Worksheet directions must never mention choices');
  assert(/show your work/i.test(html), 'expected deterministic Worksheet directions');
});

run('Worksheet: no A/B/C/D options rendered', () => {
  const html = build(worksheetQuiz, { dysgraphia: false, activity: 'Worksheet' });
  assert(!html.includes('A. '), 'expected no A/B/C/D rendering for open_response questions');
});

run('Worksheet: Show your work + answer area rendered (Standard)', () => {
  const html = build(worksheetQuiz, { dysgraphia: false, activity: 'Worksheet' });
  assert(html.includes('Show your work'), 'expected an open work-space area');
  assert(html.includes('Answer: '), 'expected a plain answer blank in standard mode');
});

run('Worksheet + Dysgraphia: larger spacing and a boxed Final Answer line', () => {
  const html = build(worksheetQuiz, { dysgraphia: true, activity: 'Worksheet' });
  assert(html.includes('Final Answer:'), 'expected a distinct Final Answer label in dysgraphia mode');
  assert(html.includes('line-height:2.4'), 'expected larger line spacing in dysgraphia mode');
  assert(html.includes('class="dysgraphia-item"'), 'expected dysgraphia item block');
});

run('Worksheet: answer key comes ONLY from final_answer', () => {
  const html = build(worksheetQuiz, { dysgraphia: false, activity: 'Worksheet' });
  assert(html.includes('1. 12') && html.includes('2. 15'), 'expected answer key sourced from final_answer');
});

// ---------------------------------------------------------------------
// Reading Comprehension (open_response + passage)
// ---------------------------------------------------------------------
run('Reading Comprehension: deterministic directions reference the passage', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes(IGNORED_MODEL_DIRECTIONS), 'model-authored directions must never appear');
  assert(/passage/i.test(html.match(/<strong>Directions:<\/strong>[^<]*/)[0]), 'expected directions to reference the passage');
});

run('Reading Comprehension: passage is rendered before questions', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  const passageIdx = html.indexOf('Nena has');
  const questionIdx = html.indexOf('How much sugar');
  assert(passageIdx !== -1, 'expected the passage text to be rendered');
  assert(passageIdx < questionIdx, 'expected the passage to render before the questions');
});

run('Reading Comprehension: open-response (no choices) even though the activity is not Worksheet', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes('A. '), 'expected no A/B/C/D rendering for Reading Comprehension');
  assert(html.includes('Show your work'), 'expected an open work-space area');
});

// ---------------------------------------------------------------------
// Matching Type (open_response, dedicated two-column renderer)
// ---------------------------------------------------------------------
run('Matching Type: deterministic directions mention matching', () => {
  const html = build(matchingQuiz, { dysgraphia: false, activity: 'Matching Type' });
  assert(!html.includes(IGNORED_MODEL_DIRECTIONS), 'model-authored directions must never appear');
  assert(/match/i.test(html.match(/<strong>Directions:<\/strong>[^<]*/)[0]), 'expected deterministic Matching Type directions');
});

run('Matching Type: answer bank contains exactly the validated final_answer values', () => {
  const html = build(matchingQuiz, { dysgraphia: false, activity: 'Matching Type' });
  ['10', '20', '30', '40', '50'].forEach((ans) => {
    assert(html.includes('. ' + ans), 'expected answer bank to contain final_answer ' + ans);
  });
});

run('Matching Type: answer bank order is a left-rotate-by-one, NOT question order, even when answers are already sorted', () => {
  const html = build(matchingQuiz, { dysgraphia: false, activity: 'Matching Type' });
  const bankSection = html.split('Answer Bank')[1].split('</div>')[0];
  const bankOrder = (bankSection.match(/\d+/g) || []);
  // Question order is [10,20,30,40,50] (already sorted ascending) -- a
  // sort-based bank would coincidentally equal this. The approved
  // left-rotate-by-one must instead produce [20,30,40,50,10].
  assert(JSON.stringify(bankOrder) === JSON.stringify(['20', '30', '40', '50', '10']), 'expected bank order [20,30,40,50,10], got ' + JSON.stringify(bankOrder));
});

run('Matching Type: answer key maps each question to its TRUE match ("N -- Letter"), never re-derived from rendered HTML', () => {
  const html = build(matchingQuiz, { dysgraphia: false, activity: 'Matching Type' });
  // bank = [20,30,40,50,10] -> A=20,B=30,C=40,D=50,E=10
  // question 1 (final_answer 10) matches bank entry E
  // question 2 (final_answer 20) matches bank entry A
  assert(html.includes('1 -- E'), 'expected question 1 (answer 10) to map to bank letter E, got: ' + html);
  assert(html.includes('2 -- A'), 'expected question 2 (answer 20) to map to bank letter A, got: ' + html);
});

run('Matching Type: no A/B/C/D inline choices rendered for the problems themselves', () => {
  const html = build(matchingQuiz, { dysgraphia: false, activity: 'Matching Type' });
  assert(!/Q1<\/p>[\s\S]{0,40}A\.\s/.test(html), 'Matching Type problems must not render inline MC-style choices');
});

run('Matching Type + Dysgraphia: remains readable/printable (dysgraphia item blocks + spacing present)', () => {
  const html = build(matchingQuiz, { dysgraphia: true, activity: 'Matching Type' });
  const blockCount = (html.match(/class="dysgraphia-item"/g) || []).length;
  assert(blockCount === matchingQuiz.questions.length, 'expected one dysgraphia item block per problem');
});

// ---------------------------------------------------------------------
// Parent/Tutor Support Sheet
// ---------------------------------------------------------------------
run('Parent/Tutor Support Sheet: deterministic directions mention a parent or tutor', () => {
  const html = build(parentTutorQuiz, { dysgraphia: false, activity: 'Parent/Tutor Support Sheet' });
  assert(!html.includes(IGNORED_MODEL_DIRECTIONS), 'model-authored directions must never appear');
  assert(/parent or tutor/i.test(html.match(/<strong>Directions:<\/strong>[^<]*/)[0]), 'expected deterministic Parent/Tutor directions');
});

run('Parent/Tutor Support Sheet: learner problems are open-response (no choices)', () => {
  const html = build(parentTutorQuiz, { dysgraphia: false, activity: 'Parent/Tutor Support Sheet' });
  assert(!html.includes('A. '), 'expected no A/B/C/D rendering');
  assert(html.includes('Show your work'), 'expected an open work-space area');
});

run('Parent/Tutor Support Sheet: a distinct Parent/Tutor Guide block is rendered, renderer-owned (static, not model text)', () => {
  const html = build(parentTutorQuiz, { dysgraphia: false, activity: 'Parent/Tutor Support Sheet' });
  assert(html.includes('class="parent-tutor-guide"'), 'expected a dedicated Parent/Tutor Guide block');
  assert(html.includes('Parent/Tutor Guide'), 'expected the Guide heading');
  assert(html.includes('Ask the learner what the problem is asking.'), 'expected the fixed, deterministic coaching bullets');
});

run('Parent/Tutor Support Sheet: solution_steps never reaches the output even with the Guide block present', () => {
  const html = build(parentTutorQuiz, { dysgraphia: false, activity: 'Parent/Tutor Support Sheet' });
  assert(!html.includes('5*3'), 'solution_steps leaked into printable HTML');
});

run('Parent/Tutor Support Sheet: final_answer still comes only from final_answer in the answer key', () => {
  const html = build(parentTutorQuiz, { dysgraphia: false, activity: 'Parent/Tutor Support Sheet' });
  assert(html.includes('1. 15'), 'expected answer key sourced from final_answer');
});

// ---------------------------------------------------------------------
// Directions ownership: quiz.directions is NEVER read for Math, any activity
// ---------------------------------------------------------------------
['Multiple Choice Quiz', 'Worksheet', 'Reading Comprehension', 'Matching Type', 'Parent/Tutor Support Sheet'].forEach((activity) => {
  run(`Directions ownership [${activity}]: a payload in quiz.directions never appears in the output`, () => {
    const quiz = activity === 'Matching Type' ? matchingQuiz
      : activity === 'Reading Comprehension' ? readingComprehensionQuiz
      : activity === 'Parent/Tutor Support Sheet' ? parentTutorQuiz
      : activity === 'Multiple Choice Quiz' ? mcQuiz
      : worksheetQuiz;
    const html = build(quiz, { dysgraphia: false, activity });
    assert(!html.includes(IGNORED_MODEL_DIRECTIONS), activity + ': model-authored directions leaked into the output');
  });
});

// ---------------------------------------------------------------------
// Visual-structure regression tests (retained from before this change)
// ---------------------------------------------------------------------
run('VISUAL STRUCTURE: dysgraphia mode wraps EVERY question in its own item block (Multiple Choice Quiz)', () => {
  const html = build(mcQuiz, { dysgraphia: true, activity: 'Multiple Choice Quiz' });
  const blockCount = (html.match(/class="dysgraphia-item"/g) || []).length;
  assert(blockCount === mcQuiz.questions.length, `expected ${mcQuiz.questions.length} per-question dysgraphia item blocks, got ${blockCount}`);
});

run('VISUAL STRUCTURE: dysgraphia + Multiple Choice renders choices NON-INLINE', () => {
  const html = build(mcQuiz, { dysgraphia: true, activity: 'Multiple Choice Quiz' });
  const choiceParagraphs = (html.match(/<p style="margin:10px 0/g) || []).length;
  assert(choiceParagraphs === 8, `expected one <p> per choice (8 total across both questions), got ${choiceParagraphs}`);
  assert(html.includes('class="dysgraphia-choices"'), 'expected a dedicated dysgraphia-choices wrapper');
});

run('VISUAL STRUCTURE: dysgraphia + Worksheet includes a dedicated, visually boxed Final Answer area', () => {
  const html = build(worksheetQuiz, { dysgraphia: true, activity: 'Worksheet' });
  assert(html.includes('class="dysgraphia-final-answer"'), 'expected a dedicated, distinctly classed Final Answer box');
  assert(html.includes('Show your work'), 'expected a dedicated work-space area alongside the final answer box');
});

run('PRINT PAGINATION: every dysgraphia question block sets break-inside and page-break-inside', () => {
  [
    build(mcQuiz, { dysgraphia: true, activity: 'Multiple Choice Quiz' }),
    build(worksheetQuiz, { dysgraphia: true, activity: 'Worksheet' })
  ].forEach((html) => {
    const itemBlocks = html.match(/<div class="dysgraphia-item" style="[^"]*"/g) || [];
    assert(itemBlocks.length > 0, 'expected at least one style-bearing dysgraphia item block');
    itemBlocks.forEach((block) => {
      assert(block.includes('break-inside:avoid'), 'expected break-inside:avoid on every dysgraphia item block');
      assert(block.includes('page-break-inside:avoid'), 'expected page-break-inside:avoid on every dysgraphia item block (older engine fallback)');
    });
  });
});

run('PRINT PAGINATION: standard (non-dysgraphia) mode never adds pagination rules', () => {
  const html = build(mcQuiz, { dysgraphia: false, activity: 'Multiple Choice Quiz' });
  assert(!html.includes('break-inside'), 'standard mode should not include break-inside at all');
  assert(!html.includes('page-break-inside'), 'standard mode should not include page-break-inside at all');
});

run('VISUAL STRUCTURE: standard (non-dysgraphia) mode receives NONE of the dysgraphia layout', () => {
  const htmlMc = build(mcQuiz, { dysgraphia: false, activity: 'Multiple Choice Quiz' });
  const htmlWorksheet = build(worksheetQuiz, { dysgraphia: false, activity: 'Worksheet' });
  ['dysgraphia-item', 'dysgraphia-choices', 'dysgraphia-final-answer'].forEach((cls) => {
    assert(!htmlMc.includes(cls), `standard MC mode must not include ${cls}`);
    assert(!htmlWorksheet.includes(cls), `standard Worksheet mode must not include ${cls}`);
  });
  assert(!htmlMc.includes('&#9744;'), 'standard MC mode must not render dysgraphia checkboxes');
  assert(!htmlWorksheet.includes('Final Answer:'), 'standard Worksheet mode must not render the dysgraphia Final Answer label');
});

run('Output reuses existing .worksheet-output-compatible tags only (h1, p, hr, answer-key div) -- no new CSS needed', () => {
  const html = build(worksheetQuiz, { dysgraphia: false, activity: 'Worksheet' });
  assert(/<h1>/.test(html), 'expected an <h1> title, matching every other printable subject');
  assert(/<div class="answer-key">/.test(html), 'expected the same .answer-key class the non-Math printable prompt already uses');
});

run('STYLE SOURCE: dysgraphia/matching/parent-tutor classes carry their own inline styles (style.css defines none of them)', () => {
  assert(!/dysgraphia/.test(styleCss), 'style.css must have no rules for dysgraphia classes -- the renderer must be fully self-contained');
  const htmlMc = build(mcQuiz, { dysgraphia: true, activity: 'Multiple Choice Quiz' });
  assert(/class="dysgraphia-item" style="[^"]+"/.test(htmlMc), 'dysgraphia-item must carry its own inline style');
  assert(/class="dysgraphia-choices" style="[^"]+"/.test(htmlMc), 'dysgraphia-choices must carry its own inline style');
  const htmlMatching = build(matchingQuiz, { dysgraphia: false, activity: 'Matching Type' });
  assert(/class="matching-bank" style="[^"]+"/.test(htmlMatching), 'matching-bank must carry its own inline style');
  const htmlParentTutor = build(parentTutorQuiz, { dysgraphia: false, activity: 'Parent/Tutor Support Sheet' });
  assert(/class="parent-tutor-guide" style="[^"]+"/.test(htmlParentTutor), 'parent-tutor-guide must carry its own inline style');
});

// ---------------------------------------------------------------------
// XSS / HTML-injection payload tests: every model-generated field must
// render as harmless visible text only.
// ---------------------------------------------------------------------
const PAYLOADS = {
  scriptTag: '<script>alert(1)</script>',
  imgOnerror: '<img src=x onerror=alert(1)>',
  ltAmpGt: '5 < 7 & 8 > 3',
  quotes: '"quoted" and \'quoted\''
};

function assertNeverRaw(html, payload, fieldLabel) {
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
    const quiz = { title: payload, questions: [{ type: 'open_response', question: 'q', final_answer: 'a' }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Worksheet' });
    assertNeverRaw(html, payload, 'title');
  });

  run(`XSS payload [${key}] in passage renders as harmless text only`, () => {
    const quiz = { title: 't', passage: payload, questions: [{ type: 'open_response', question: 'q', final_answer: 'a' }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
    assertNeverRaw(html, payload, 'passage');
  });

  run(`XSS payload [${key}] in question text renders as harmless text only`, () => {
    const quiz = { title: 't', questions: [{ type: 'open_response', question: payload, final_answer: 'a' }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Worksheet' });
    assertNeverRaw(html, payload, 'question');
  });

  run(`XSS payload [${key}] in a choice renders as harmless text only (Multiple Choice Quiz activity)`, () => {
    const quiz = { title: 't', questions: [{ type: 'multiple_choice', question: 'q', final_answer: 'a', choices: [payload, 'b', 'c', 'd'] }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Multiple Choice Quiz' });
    assertNeverRaw(html, payload, 'choices');
  });

  run(`XSS payload [${key}] in final_answer renders as harmless text only (inside the answer key)`, () => {
    const quiz = { title: 't', questions: [{ type: 'open_response', question: 'q', final_answer: payload }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Worksheet' });
    assertNeverRaw(html, payload, 'final_answer');
  });

  run(`XSS payload [${key}] in final_answer renders as harmless text only (inside a Matching Type answer bank)`, () => {
    const quiz = { title: 't', questions: [{ type: 'open_response', question: 'q1', final_answer: payload }, { type: 'open_response', question: 'q2', final_answer: 'unique-2' }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Matching Type' });
    assertNeverRaw(html, payload, 'matching bank final_answer');
  });

  run(`XSS payload [${key}] in solution_steps NEVER appears at all (field is never read by the renderer)`, () => {
    const quiz = { title: 't', questions: [{ type: 'open_response', question: 'q', solution_steps: payload, final_answer: 'a' }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Worksheet' });
    assert(!html.includes(payload), 'solution_steps payload leaked into HTML even though this field should never be read');
    const plainMarker = payload.replace(/[<>]/g, '');
    if (plainMarker.length > 3) {
      assert(!html.includes(plainMarker), 'solution_steps content (even de-tagged) leaked into HTML');
    }
  });

  run(`XSS payload [${key}] in passage_evidence NEVER appears at all (field is never read by the renderer)`, () => {
    const quiz = { title: 't', passage: 'harmless passage text', questions: [{ type: 'open_response', question: 'q', passage_evidence: payload, final_answer: 'a' }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
    assert(!html.includes(payload), 'passage_evidence payload leaked into HTML even though this field should never be read');
  });
});

// ---------------------------------------------------------------------
// Source-level checks
// ---------------------------------------------------------------------
run('SOURCE CHECK: buildPrintableMathHtml keys choice rendering off q.type, not a caller-supplied boolean', () => {
  assert(appJsSource.includes("q.type === 'multiple_choice'"), 'expected choice rendering to key off the validated q.type field');
  assert(!appJsSource.includes('opts.isMultipleChoice') && !appJsSource.includes('isMultipleChoice:'), 'expected the old isMultipleChoice flag/param to be gone -- schema type is now the single source of truth');
});

run('SOURCE CHECK: directions are selected from a fixed lookup table, quiz.directions is never read inside buildPrintableMathHtml', () => {
  const lines = appJsSource.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('function buildPrintableMathHtml('));
  assert(startIdx !== -1, 'could not locate buildPrintableMathHtml in app.js source for inspection -- has it been renamed or restructured?');
  const endIdx = lines.findIndex((l, i) => i > startIdx && /^function \w+\(/.test(l));
  assert(endIdx !== -1, 'could not locate the next top-level function after buildPrintableMathHtml -- boundary detection may be broken');
  const body = lines.slice(startIdx, endIdx).join('\n');
  assert(!body.includes('quiz.directions'), 'buildPrintableMathHtml must never read quiz.directions -- directions are renderer-owned');
  assert(!body.includes('solution_steps'), 'buildPrintableMathHtml\'s source body references solution_steps -- it must never read this field at all');
  assert(!body.includes('passage_evidence'), 'buildPrintableMathHtml\'s source body references passage_evidence -- it is validation-only metadata and must never be read here');
});

run('SOURCE CHECK: MATH_DIRECTIONS_BY_ACTIVITY has an entry for all 5 Math-eligible activities', () => {
  ['Multiple Choice Quiz', 'Worksheet', 'Reading Comprehension', 'Matching Type', 'Parent/Tutor Support Sheet'].forEach((activity) => {
    assert(appJsSource.includes(`'${activity}':`), `expected MATH_DIRECTIONS_BY_ACTIVITY to have a key for "${activity}"`);
  });
});

console.log('\nDone.');

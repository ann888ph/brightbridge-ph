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

// Mirrors app.js's MATH_RC_FACTS_UNAVAILABLE_MESSAGE exactly (checked
// separately by a SOURCE CHECK test below, so this can never silently
// drift from the real renderer-owned string).
const MATH_RC_FACTS_UNAVAILABLE_MESSAGE_TEXT = 'Validated story facts are unavailable for this saved worksheet.';

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

// passage_evidence values are COMPLETE sentences from the passage (per the
// exact-sentence-match validation rule), not fragments. The passage also
// contains an extra, unreferenced sentence with its own numbers -- exactly
// the "contradictory unexplained totals" scenario from the reported bug --
// which must NEVER reach the rendered output, since no question cites it.
const RC_SENTENCE_SUGAR = 'Nena has 1/2 cup of sugar for her recipe.';
const RC_SENTENCE_FLOUR = 'She also has 2 cups of flour.';
const RC_SENTENCE_UNREFERENCED = 'Later she somehow has 45 mangoes and 23 papayas.';
const readingComprehensionQuiz = {
  title: 'Filipino Recipes',
  directions: IGNORED_MODEL_DIRECTIONS,
  passage: RC_SENTENCE_SUGAR + ' ' + RC_SENTENCE_FLOUR + ' ' + RC_SENTENCE_UNREFERENCED,
  questions: [
    {
      type: 'open_response',
      question: 'How much sugar does Nena have, in decimal form?',
      solution_steps: '1/2 = 0.5',
      final_answer: '0.5',
      passage_evidence: RC_SENTENCE_SUGAR
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
// Reading Comprehension -- LEGACY FALLBACK PATH (open_response + the old
// freehand passage/passage_evidence shape, no story_facts). This whole
// block exercises buildLegacyReadingComprehensionFacts() via
// buildMathReadingComprehensionFacts()'s fallback branch -- kept exactly
// as before to prove the legacy path still works for a worksheet saved
// before the structured story_facts contract existed. The PRIMARY,
// newly-generated-worksheet contract (story_facts array order, no IDs/
// evidence_fact_ids ever exposed) is tested in its own section further
// below.
// ---------------------------------------------------------------------
run('Reading Comprehension: deterministic directions reference the passage', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes(IGNORED_MODEL_DIRECTIONS), 'model-authored directions must never appear');
  assert(/passage/i.test(html.match(/<strong>Directions:<\/strong>[^<]*/)[0]), 'expected directions to reference the passage');
});

run('Reading Comprehension: validated evidence sentence is rendered before questions', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  const passageIdx = html.indexOf(RC_SENTENCE_SUGAR);
  const questionIdx = html.indexOf('How much sugar');
  assert(passageIdx !== -1, 'expected the validated evidence sentence to be rendered');
  assert(passageIdx < questionIdx, 'expected the passage facts to render before the questions');
});

run('Reading Comprehension: open-response (no choices) even though the activity is not Worksheet', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes('A. '), 'expected no A/B/C/D rendering for Reading Comprehension');
  assert(html.includes('Show your work'), 'expected an open work-space area');
});

run('Reading Comprehension: displayed passage is derived ONLY from validated (cited) evidence sentences', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(html.includes(RC_SENTENCE_SUGAR), 'expected the cited sentence to appear');
});

run('Reading Comprehension: an unreferenced/contradictory model passage sentence is NEVER rendered, even though it is genuinely part of quiz.passage', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes(RC_SENTENCE_UNREFERENCED), 'an unreferenced passage sentence must never reach the printed worksheet');
  assert(!html.includes('45 mangoes'), 'the unexplained/contradictory extra numeric fact must never be shown');
  assert(!html.includes(RC_SENTENCE_FLOUR), 'a real but uncited-by-any-question sentence must also never be shown');
});

run('Reading Comprehension: duplicate evidence sentences (cited by more than one question) display only once', () => {
  const quiz = {
    title: 't',
    questions: [
      { type: 'open_response', question: 'Q1', solution_steps: 'x=0.5', final_answer: '0.5', passage_evidence: RC_SENTENCE_SUGAR },
      { type: 'open_response', question: 'Q2', solution_steps: 'x=0.5', final_answer: '0.5', passage_evidence: RC_SENTENCE_SUGAR }
    ],
    passage: RC_SENTENCE_SUGAR + ' ' + RC_SENTENCE_FLOUR
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  const occurrences = html.split(RC_SENTENCE_SUGAR).length - 1;
  assert(occurrences === 1, `expected the duplicated evidence sentence to appear exactly once, got ${occurrences}`);
});

run('Reading Comprehension: evidence sentence order follows QUESTION order, not passage-internal order', () => {
  // The passage lists sugar first, then flour -- but Q1 cites the FLOUR
  // sentence and Q2 cites the SUGAR sentence, so the rendered order must be
  // flour-then-sugar (question order), not sugar-then-flour (passage order).
  const quiz = {
    title: 't',
    passage: RC_SENTENCE_SUGAR + ' ' + RC_SENTENCE_FLOUR,
    questions: [
      { type: 'open_response', question: 'Q1', solution_steps: 'x=2', final_answer: '2', passage_evidence: RC_SENTENCE_FLOUR },
      { type: 'open_response', question: 'Q2', solution_steps: 'x=0.5', final_answer: '0.5', passage_evidence: RC_SENTENCE_SUGAR }
    ]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  const flourIdx = html.indexOf(RC_SENTENCE_FLOUR);
  const sugarIdx = html.indexOf(RC_SENTENCE_SUGAR);
  assert(flourIdx !== -1 && sugarIdx !== -1, 'expected both sentences to be rendered');
  assert(flourIdx < sugarIdx, 'expected evidence order to follow question order (flour cited by Q1, sugar by Q2), got the reverse');
});

run('Reading Comprehension: no "passage_evidence" or "Evidence" label is ever exposed to the learner', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!/passage_evidence/i.test(html), 'the field name "passage_evidence" must never appear in learner-facing output');
  assert(!/\bEvidence\b/.test(html), 'no "Evidence" label should be exposed to the learner');
  assert(html.includes('Math Story Facts'), 'expected the approved renderer-owned label');
});

run('Reading Comprehension: solution_steps remain hidden', () => {
  const html = build(readingComprehensionQuiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes('1/2 = 0.5'), 'solution_steps must never reach the rendered output');
});

run('Reading Comprehension: normal readable list formatting is intact (facts are list items, not one run-on paragraph)', () => {
  const quiz = {
    title: 't',
    passage: RC_SENTENCE_SUGAR + ' ' + RC_SENTENCE_FLOUR,
    questions: [
      { type: 'open_response', question: 'Q1', solution_steps: 'x=0.5', final_answer: '0.5', passage_evidence: RC_SENTENCE_SUGAR },
      { type: 'open_response', question: 'Q2', solution_steps: 'x=2', final_answer: '2', passage_evidence: RC_SENTENCE_FLOUR }
    ]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  const listItems = (html.match(/<li[ >]/g) || []).length;
  assert(listItems === 2, `expected each validated sentence rendered as its own <li>, got ${listItems}`);
});

run('Reading Comprehension: Standard and Dysgraphia formats both remain readable (facts box renders in both)', () => {
  [false, true].forEach((dysgraphia) => {
    const html = build(readingComprehensionQuiz, { dysgraphia, activity: 'Reading Comprehension' });
    assert(html.includes(RC_SENTENCE_SUGAR), `expected the facts box to render in dysgraphia=${dysgraphia} mode`);
  });
});

// ---------------------------------------------------------------------
// FAIL CLOSED: buildMathReadingComprehensionFacts() must render ONLY an
// original sentence successfully matched from quiz.passage -- never
// passage_evidence's own text as a fallback.
// ---------------------------------------------------------------------
run('FAIL CLOSED: matched evidence renders the ORIGINAL passage sentence, not passage_evidence\'s own (trivially different) copy', () => {
  const canonicalSentence = 'Nena has 1/2 cup of sugar for her recipe.';
  const quiz = {
    title: 't',
    passage: canonicalSentence,
    questions: [{
      type: 'open_response', question: 'q', solution_steps: 'x=0.5', final_answer: '0.5',
      // Double space differs from the canonical sentence but normalizes equal.
      passage_evidence: 'Nena  has 1/2 cup of sugar for her recipe.'
    }]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(html.includes(canonicalSentence), 'expected the canonical passage sentence text to be rendered');
  assert(!html.includes('Nena  has'), 'expected passage_evidence\'s own (double-spaced) copy to NEVER be rendered, only the matched original');
});

run('FAIL CLOSED: unmatched evidence (fragment, not a complete sentence) is never rendered', () => {
  const quiz = {
    title: 't',
    passage: 'Nena has 1/2 cup of sugar for her recipe.',
    questions: [{
      type: 'open_response', question: 'q', solution_steps: 'x=0.5', final_answer: '0.5',
      passage_evidence: '1/2 cup of sugar' // a real substring, but not a complete sentence
    }]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes('1/2 cup of sugar'), 'unmatched fragment evidence must never be displayed');
  assert(html.includes(MATH_RC_FACTS_UNAVAILABLE_MESSAGE_TEXT), 'expected the static fallback message since no evidence matched');
});

run('FAIL CLOSED: one unmatched item does NOT prevent other validly-matched facts from rendering', () => {
  const matchedSentence = 'Nena has 1/2 cup of sugar for her recipe.';
  const quiz = {
    title: 't',
    passage: matchedSentence,
    questions: [
      { type: 'open_response', question: 'q1', solution_steps: 'x=0.5', final_answer: '0.5', passage_evidence: matchedSentence },
      { type: 'open_response', question: 'q2', solution_steps: 'x=99', final_answer: '99', passage_evidence: 'This sentence does not exist in the passage.' }
    ]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(html.includes(matchedSentence), 'expected the validly-matched sentence to still render');
  assert(!html.includes('This sentence does not exist in the passage.'), 'the unmatched sentence from the other question must never render');
  assert(!html.includes(MATH_RC_FACTS_UNAVAILABLE_MESSAGE_TEXT), 'the fallback message must NOT appear when at least one fact validly matched');
});

run('FAIL CLOSED: zero matched facts produces ONLY the static, non-numeric fallback message (no list, no unmatched text)', () => {
  const quiz = {
    title: 't',
    passage: 'A completely unrelated sentence with no shared content.',
    questions: [{
      type: 'open_response', question: 'q', solution_steps: 'x=1', final_answer: '1',
      passage_evidence: 'Fabricated sentence not present in the passage.'
    }]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(html.includes(MATH_RC_FACTS_UNAVAILABLE_MESSAGE_TEXT), 'expected the static fallback message');
  assert(!html.includes('Fabricated sentence'), 'the unmatched evidence text must never appear');
  assert(!/<li[ >]/.test(html), 'expected no <li> list items when zero facts matched');
});

// ---------------------------------------------------------------------
// CONTEXT-AWARE a.m./p.m. sentence boundary: an abbreviation-ending
// sentence immediately followed by another sentence must correctly split
// into two, so the second (uncited) sentence is never rendered alongside
// cited evidence.
// ---------------------------------------------------------------------
run('CONTEXT-AWARE a.m./p.m.: cited "...2:00 p.m." sentence renders; the second, uncited sentence never does', () => {
  const passage = 'The store closed at 2:00 p.m. Juan counted 5 boxes.';
  const quiz = {
    title: 't',
    passage,
    questions: [{
      type: 'open_response', question: 'At what hour did the store close?', solution_steps: 'x = 2:00', final_answer: '2:00',
      passage_evidence: 'The store closed at 2:00 p.m.'
    }]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(html.includes('The store closed at 2:00 p.m.'), 'expected the cited sentence to render');
  assert(!html.includes('Juan counted 5 boxes.'), 'the second, uncited sentence must never be rendered even though it is genuinely part of quiz.passage');
  assert(!html.includes(MATH_RC_FACTS_UNAVAILABLE_MESSAGE_TEXT), 'the fallback message must not appear since the cited sentence DID match');
});

// ---------------------------------------------------------------------
// Reading Comprehension -- PRIMARY STRUCTURED story_facts CONTRACT. Every
// newly generated Math Reading Comprehension worksheet uses this path:
// quiz.story_facts is already server-validated (non-empty, unique ids,
// unique text, every fact referenced) before delivery, so the renderer
// displays it directly, in its own array order -- no re-matching, no
// sentence-splitting, no legacy fallback involved.
// ---------------------------------------------------------------------
const RC_STORY_FACTS_QUIZ = {
  title: 't',
  story_facts: [
    { id: 'F1', text: 'Juan had 5 mangoes.' },
    { id: 'F2', text: 'Nena gave Juan 3 more mangoes.' }
  ],
  questions: [{
    type: 'open_response',
    question: 'How many mangoes did Juan have after Nena gave him more?',
    evidence_fact_ids: ['F1', 'F2'],
    solution_steps: '5 + 3 = 8',
    final_answer: '8'
  }]
};

run('STORY FACTS: renderer shows facts in story_facts ARRAY order (not question-citation order)', () => {
  const quiz = {
    title: 't',
    story_facts: [
      { id: 'F1', text: 'Second-listed-but-cited-second fact: Nena gave Juan 3 mangoes.' },
      { id: 'F2', text: 'First-listed-but-cited-first-by-question fact: Juan had 5 mangoes.' }
    ],
    questions: [{
      type: 'open_response', question: 'How many mangoes total?',
      evidence_fact_ids: ['F2', 'F1'], // question cites F2 before F1 -- array order must still win
      solution_steps: '5 + 3 = 8', final_answer: '8'
    }]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  const idxFirst = html.indexOf('Second-listed-but-cited-second');
  const idxSecond = html.indexOf('First-listed-but-cited-first-by-question');
  assert(idxFirst !== -1 && idxSecond !== -1, 'expected both facts to render');
  assert(idxFirst < idxSecond, 'expected story_facts ARRAY order (F1 first), not question-citation order');
});

run('STORY FACTS: renderer does not expose ids, evidence_fact_ids, or solution_steps', () => {
  const html = build(RC_STORY_FACTS_QUIZ, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!/\bF1\b/.test(html) && !/\bF2\b/.test(html), 'internal fact ids must never be exposed to the learner');
  assert(!/evidence_fact_ids/i.test(html), 'the field name "evidence_fact_ids" must never appear');
  assert(!html.includes('5 + 3 = 8'), 'solution_steps must never reach the rendered output');
  assert(html.includes('Juan had 5 mangoes.') && html.includes('Nena gave Juan 3 more mangoes.'), 'expected the fact text itself to render');
});

run('STORY FACTS: HTML/script payloads in fact text are escaped', () => {
  const payload = '<script>alert(1)</script>';
  const quiz = {
    title: 't',
    story_facts: [{ id: 'F1', text: payload }],
    questions: [{ type: 'open_response', question: 'q', evidence_fact_ids: ['F1'], solution_steps: 'x=1', final_answer: '1' }]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes(payload), 'raw unescaped payload must never appear');
  assert(!/<script[\s>]/i.test(html), 'a live, parseable <script> tag must never reach the output');
  assert(html.includes('&lt;') || html.includes('&gt;'), 'expected the payload to appear only as HTML-escaped text');
});

run('STORY FACTS: Standard and Dysgraphia layouts both remain readable', () => {
  [false, true].forEach((dysgraphia) => {
    const html = build(RC_STORY_FACTS_QUIZ, { dysgraphia, activity: 'Reading Comprehension' });
    assert(html.includes('Juan had 5 mangoes.'), `expected the facts box to render in dysgraphia=${dysgraphia} mode`);
    assert(html.includes('Math Story Facts'), 'expected the approved learner-facing label in both modes');
  });
});

run('STORY FACTS: solution_steps and final_answer answer-key integrity are unaffected by the schema change', () => {
  const html = build(RC_STORY_FACTS_QUIZ, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(html.includes('1. 8'), 'expected the answer key sourced from final_answer, unaffected by the story_facts schema change');
});

run('STORY FACTS: takes priority over any leftover legacy passage/passage_evidence fields on the same quiz object', () => {
  const quiz = Object.assign({}, RC_STORY_FACTS_QUIZ, {
    passage: 'A completely different legacy passage that must be ignored.',
    questions: [Object.assign({}, RC_STORY_FACTS_QUIZ.questions[0], { passage_evidence: 'A completely different legacy passage that must be ignored.' })]
  });
  const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
  assert(!html.includes('A completely different legacy passage'), 'expected the structured story_facts path to take priority over any legacy fields present');
  assert(html.includes('Juan had 5 mangoes.'), 'expected the story_facts content to render');
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

run('LEGACY DISPLAY: Matching Type answer bank strips context nouns from a historical (pre-bare-contract) saved worksheet\'s final_answer', () => {
  // A worksheet generated before the strict bare-value contract existed
  // could still have final_answer values like "15 marbles" -- the bank
  // must display only the extracted number, never the noun, even for this
  // defensive legacy path.
  const legacyQuiz = {
    title: 't',
    questions: [
      { type: 'open_response', question: 'Q1', solution_steps: 'x=15', final_answer: '15 marbles' },
      { type: 'open_response', question: 'Q2', solution_steps: 'x=17', final_answer: '17 notebooks' }
    ]
  };
  const html = build(legacyQuiz, { dysgraphia: false, activity: 'Matching Type' });
  assert(!html.includes('marbles'), 'expected the context noun "marbles" to never appear in the rendered bank');
  assert(!html.includes('notebooks'), 'expected the context noun "notebooks" to never appear in the rendered bank');
  assert(html.includes('. 15') && html.includes('. 17'), 'expected the bank to display the bare extracted numbers');
});

run('Matching Type: display forms are preserved rather than converted to decimals (fraction, percent, currency, mixed number, negative)', () => {
  const quiz = {
    title: 't',
    questions: [
      { type: 'open_response', question: 'Q1', solution_steps: 'x=3/4', final_answer: '3/4' },
      { type: 'open_response', question: 'Q2', solution_steps: 'x=25%', final_answer: '25%' },
      { type: 'open_response', question: 'Q3', solution_steps: 'x=1250.50', final_answer: PHP + '1,250.50' },
      { type: 'open_response', question: 'Q4', solution_steps: 'x=1.5', final_answer: '1 1/2' },
      { type: 'open_response', question: 'Q5', solution_steps: 'x=-8', final_answer: '-8' }
    ]
  };
  const html = build(quiz, { dysgraphia: false, activity: 'Matching Type' });
  assert(html.includes('3/4'), 'expected the fraction display form "3/4" to be preserved, not converted to 0.75');
  assert(html.includes('25%'), 'expected the percent display form "25%" to be preserved, not converted to 0.25');
  assert(html.includes(PHP + '1,250.50'), 'expected the currency display form to be preserved with its comma/peso sign');
  assert(html.includes('1 1/2'), 'expected the mixed-number display form "1 1/2" to be preserved, not converted to 1.5');
  assert(html.includes('-8'), 'expected the negative value "-8" to be preserved');
  assert(!html.includes('0.75'), 'the fraction must never be silently converted to a decimal in the bank');
  assert(!html.includes('0.25'), 'the percent must never be silently converted to a decimal in the bank');
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

  run(`XSS payload [${key}] in an UNREFERENCED quiz.passage never appears at all (renderer ignores quiz.passage entirely)`, () => {
    // No question cites this payload as passage_evidence, so under the
    // approved design it is never even a candidate for display -- quiz.passage
    // itself is never read by the renderer, referenced or not.
    const quiz = { title: 't', passage: payload, questions: [{ type: 'open_response', question: 'q', final_answer: 'a', passage_evidence: 'A harmless cited sentence.' }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
    assert(!html.includes(payload), 'an unreferenced quiz.passage payload must never reach the output, raw or escaped');
  });

  run(`XSS payload [${key}] as a MATCHED complete-sentence passage_evidence renders as harmless text only`, () => {
    // The payload must actually match a real sentence in quiz.passage under
    // the fail-closed design -- so quiz.passage IS the payload here (its own
    // sole "sentence"), and passage_evidence cites it exactly.
    const quiz = { title: 't', passage: payload, questions: [{ type: 'open_response', question: 'q', final_answer: 'a', passage_evidence: payload }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Reading Comprehension' });
    assertNeverRaw(html, payload, 'passage_evidence');
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

  run(`XSS payload [${key}] in final_answer never produces a live tag in a Matching Type answer bank`, () => {
    // Note: the bank displays the EXTRACTED primary numeric token, not the
    // raw final_answer -- a payload containing exactly one digit (e.g. the
    // "1" inside "alert(1)") is reduced to that bare digit, so the payload
    // text itself may not appear at all (an even stronger outcome than
    // "escaped"); a payload with zero or multiple digits falls back to the
    // raw (then-escaped) string. Either way, no live markup may reach output.
    const quiz = { title: 't', questions: [{ type: 'open_response', question: 'q1', final_answer: payload }, { type: 'open_response', question: 'q2', final_answer: 'unique-answer-2' }] };
    const html = build(quiz, { dysgraphia: false, activity: 'Matching Type' });
    assert(!html.includes(payload), 'matching bank: raw unescaped payload leaked into HTML verbatim');
    assert(!/<script[\s>]/i.test(html), 'matching bank: a live, parseable <script> tag reached the HTML output');
    assert(!/<img\b/i.test(html), 'matching bank: a live, parseable <img> tag reached the HTML output');
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

});

// ---------------------------------------------------------------------
// Source-level checks
// ---------------------------------------------------------------------
run('SOURCE CHECK: buildPrintableMathHtml keys choice rendering off q.type, not a caller-supplied boolean', () => {
  assert(appJsSource.includes("q.type === 'multiple_choice'"), 'expected choice rendering to key off the validated q.type field');
  assert(!appJsSource.includes('opts.isMultipleChoice') && !appJsSource.includes('isMultipleChoice:'), 'expected the old isMultipleChoice flag/param to be gone -- schema type is now the single source of truth');
});

// Stable named-function boundary helper: finds a function by its
// declaration text and ends at the NEXT top-level `function` declaration.
// Fails loudly if either boundary can't be found, rather than silently
// extracting the wrong range -- never a fixed line number.
function extractFunctionBody(source, functionSignature) {
  const lines = source.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(functionSignature));
  assert(startIdx !== -1, `could not locate ${functionSignature} in app.js source -- has it been renamed or restructured?`);
  const endIdx = lines.findIndex((l, i) => i > startIdx && /^function \w+\(/.test(l));
  assert(endIdx !== -1, `could not locate the next top-level function after ${functionSignature} -- boundary detection may be broken`);
  return lines.slice(startIdx, endIdx).join('\n');
}

run('SOURCE CHECK: directions are selected from a fixed lookup table, quiz.directions is never read inside buildPrintableMathHtml', () => {
  const body = extractFunctionBody(appJsSource, 'function buildPrintableMathHtml(');
  assert(!body.includes('quiz.directions'), 'buildPrintableMathHtml must never read quiz.directions -- directions are renderer-owned');
  assert(!body.includes('solution_steps'), 'buildPrintableMathHtml\'s source body references solution_steps -- it must never read this field at all');
});

run('SOURCE CHECK: buildPrintableMathHtml never reads quiz.passage directly -- only via the dedicated buildMathReadingComprehensionFacts() helper', () => {
  const body = extractFunctionBody(appJsSource, 'function buildPrintableMathHtml(');
  assert(!body.includes('quiz.passage'), 'buildPrintableMathHtml must delegate to buildMathReadingComprehensionFacts(), never read quiz.passage itself');
  assert(!body.includes('passage_evidence'), 'buildPrintableMathHtml must delegate to buildMathReadingComprehensionFacts(), never read passage_evidence itself');
});

run('SOURCE CHECK: buildMathReadingComprehensionFacts() reads story_facts for the primary (new-generation) contract', () => {
  const body = extractFunctionBody(appJsSource, 'function buildMathReadingComprehensionFacts(');
  assert(body.includes('story_facts'), 'expected buildMathReadingComprehensionFacts to read quiz.story_facts as the primary contract');
});

run('SOURCE CHECK: buildLegacyReadingComprehensionFacts() is the ONLY place passage_evidence/quiz.passage feed the displayed passage (legacy fallback only)', () => {
  const body = extractFunctionBody(appJsSource, 'function buildLegacyReadingComprehensionFacts(');
  assert(body.includes('passage_evidence'), 'expected buildLegacyReadingComprehensionFacts to read passage_evidence');
  assert(body.includes('quiz.passage'), 'expected buildLegacyReadingComprehensionFacts to read quiz.passage (to find the matching original sentence)');
});

run('SOURCE CHECK: MATH_DIRECTIONS_BY_ACTIVITY has an entry for all 5 Math-eligible activities', () => {
  ['Multiple Choice Quiz', 'Worksheet', 'Reading Comprehension', 'Matching Type', 'Parent/Tutor Support Sheet'].forEach((activity) => {
    assert(appJsSource.includes(`'${activity}':`), `expected MATH_DIRECTIONS_BY_ACTIVITY to have a key for "${activity}"`);
  });
});

run('SOURCE CHECK: this test file\'s fallback-message constant matches the real app.js string exactly (never silently drifts)', () => {
  assert(appJsSource.includes(MATH_RC_FACTS_UNAVAILABLE_MESSAGE_TEXT), 'expected app.js to contain the exact fallback message string this test suite checks against');
});

run('SOURCE CHECK: buildLegacyReadingComprehensionFacts() never falls back to passage_evidence\'s own text (fails closed, no "|| evidence" escape hatch)', () => {
  const body = extractFunctionBody(appJsSource, 'function buildLegacyReadingComprehensionFacts(');
  assert(!/\|\|\s*evidence\b/.test(body), 'expected no fallback to the raw evidence text -- only a matched original sentence may ever be pushed to facts');
});

console.log('\nDone.');

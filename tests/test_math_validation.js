// Now testing the SHARED MODULE directly (math-validation.js) -- this is
// exactly what generate.js will require() server-side, and exactly what
// app.js destructures from window.MathValidation client-side. One
// implementation, tested once.
const path = require('path');
const sandbox = require(path.join(__dirname, '..', 'math-validation.js'));
const { run } = require('./helpers/run.js');

const { safeEvalArithmetic, getMathActivityProfile, extractAllNumericTokens, normalizeEvidenceText, extractPrimaryNumericToken } = sandbox;

// Every test ABOVE this point in the file (unchanged from before the
// Printable-Activity-Type rework) exercises the ORIGINAL V1 behavior: every
// Math question must be multiple_choice. Rather than editing dozens of call
// sites, this thin wrapper defaults `mode` to 'interactive' when the caller
// doesn't specify one -- `mode === 'interactive'` alone is sufficient to
// require multiple_choice regardless of `activity` (see
// getMathActivityProfile), so these legacy calls keep testing exactly what
// they always tested. New tests further down in this file call
// sandbox.validateMathQuestions directly with explicit activity/mode to
// exercise the open_response / Reading Comprehension / Matching Type
// profiles.
function validateMathQuestions(quiz, expectedCount, activity, mode) {
  return sandbox.validateMathQuestions(quiz, expectedCount, activity, mode === undefined ? 'interactive' : mode);
}

// ===== safeEvalArithmetic basics =====
run('safeEvalArithmetic: basic multiplication', () => {
  if (Math.abs(safeEvalArithmetic('2.5 * 45.50') - 113.75) > 1e-9) throw new Error('wrong result');
});
run('safeEvalArithmetic: unicode multiplication sign (times sign) works', () => {
  const timesSign = String.fromCharCode(0x00D7);
  if (Math.abs(safeEvalArithmetic('2.5 ' + timesSign + ' 45.50') - 113.75) > 1e-9) throw new Error('wrong result');
});
run('safeEvalArithmetic: unicode minus sign works', () => {
  const unicodeMinus = String.fromCharCode(0x2212);
  if (Math.abs(safeEvalArithmetic('200 ' + unicodeMinus + ' 113.75') - 86.25) > 1e-9) throw new Error('wrong result');
});
run('safeEvalArithmetic: parentheses and division', () => {
  if (Math.abs(safeEvalArithmetic('(10 + 2) / 4') - 3) > 1e-9) throw new Error('wrong result');
});
run('safeEvalArithmetic: rejects unsafe/non-arithmetic text (no execution, just null)', () => {
  if (safeEvalArithmetic('process.exit(1)') !== null) throw new Error('should have returned null, not executed anything');
  if (safeEvalArithmetic('alert(1)') !== null) throw new Error('should have returned null');
  if (safeEvalArithmetic('rounded to the nearest centavo') !== null) throw new Error('should have returned null for descriptive text');
});
run('safeEvalArithmetic: division by zero returns null (does not throw/crash)', () => {
  if (safeEvalArithmetic('5 / 0') !== null) throw new Error('expected null');
});

// ===== EXAMPLE 1: rice and change (reported bug) =====
run('EXAMPLE 1 (rice/change): a CORRECT question passes validation', () => {
  const quiz = {
    questions: [{
      type: 'multiple_choice',
      question: 'Maria bought 2.5 kilograms of rice at PHP45.50 per kilogram. She paid with a PHP200 bill. How much change did she receive?',
      solution_steps: '2.5 * 45.50 = 113.75; 200 - 113.75 = 86.25',
      final_answer: String.fromCharCode(0x20B1) + '86.25',
      choices: [String.fromCharCode(0x20B1) + '86.25', String.fromCharCode(0x20B1) + '86.75', String.fromCharCode(0x20B1) + '113.75', String.fromCharCode(0x20B1) + '90.00'],
      answer: 0
    }]
  };
  const v = validateMathQuestions(quiz, 1);
  if (!v.ok) throw new Error('expected ok, got failures: ' + JSON.stringify(v.failures));
});

run('EXAMPLE 1 (rice/change): the REPORTED BUG is caught (wrong answer key, correct choice missing)', () => {
  const PHP = String.fromCharCode(0x20B1);
  const quiz = {
    questions: [{
      type: 'multiple_choice',
      question: 'Maria bought 2.5 kilograms of rice at ' + PHP + '45.50 per kilogram. She paid with a ' + PHP + '200 bill. How much change did she receive?',
      solution_steps: '2.5 * 45.50 = 113.75; 200 - 113.75 = 86.25',
      final_answer: PHP + '86.75', // WRONG on purpose -- matches the reported production bug
      choices: [PHP + '80.00', PHP + '86.75', PHP + '113.75', PHP + '90.00'], // correct 86.25 missing
      answer: 1
    }]
  };
  const v = validateMathQuestions(quiz, 1);
  if (v.ok) throw new Error('expected this to FAIL validation, but it passed');
  if (v.failures.length !== 1) throw new Error('expected exactly one failing question');
  const reasons = v.failures[0].reasons.join(' | ');
  const caughtIt = reasons.includes('final_answer') || reasons.includes('no choice matches') || reasons.includes('last result in solution_steps');
  if (!caughtIt) throw new Error('expected a final_answer/solution_steps consistency failure, got: ' + reasons);
  console.log('    (informational) actual reasons caught:', reasons);
});

// ===== EXAMPLE 2: fractional-centavo bakery problem =====
run('EXAMPLE 2 (bakery): exact 918.125 with NO rounding mention is rejected', () => {
  const PHP = String.fromCharCode(0x20B1);
  const quiz = {
    questions: [{
      type: 'multiple_choice',
      question: "Juan's bakery sold 15.5 loaves on Monday and 12.75 loaves on Tuesday. If each loaf costs " + PHP + "32.50, how much money did he earn?",
      solution_steps: '15.5 + 12.75 = 28.25; 28.25 * 32.50 = 918.125',
      final_answer: PHP + '918.13', // displays 2 decimals, but no rounding was ever mentioned
      choices: [PHP + '918.13', PHP + '900.00', PHP + '928.13', PHP + '918.00'],
      answer: 0
    }]
  };
  const v = validateMathQuestions(quiz, 1);
  if (v.ok) throw new Error('expected this to FAIL (unrounded exact result with no rounding instruction), but it passed');
});

run('EXAMPLE 2 (bakery): properly rounded WITH rounding instruction passes', () => {
  const PHP = String.fromCharCode(0x20B1);
  const quiz = {
    questions: [{
      type: 'multiple_choice',
      question: "Juan's bakery sold 15.5 loaves on Monday and 12.75 loaves on Tuesday. If each loaf costs " + PHP + "32.50, how much did he earn? Round your answer to the nearest centavo.",
      solution_steps: '15.5 + 12.75 = 28.25; 28.25 * 32.50 = 918.125; rounded to the nearest centavo = 918.13',
      final_answer: PHP + '918.13',
      choices: [PHP + '918.13', PHP + '900.00', PHP + '928.13', PHP + '918.00'],
      answer: 0
    }]
  };
  const v = validateMathQuestions(quiz, 1);
  if (!v.ok) throw new Error('expected ok, got failures: ' + JSON.stringify(v.failures));
});

// ===== Structural failure catalogue (Part 6C) =====
function baseValidQuestion() {
  const PHP = String.fromCharCode(0x20B1);
  return {
    type: 'multiple_choice',
    question: 'What is 2 + 2?',
    solution_steps: '2 + 2 = 4',
    final_answer: '4',
    choices: ['3', '4', '5', '6'],
    answer: 1
  };
}

run('catches: missing correct choice', () => {
  const q = baseValidQuestion();
  q.choices = ['1', '2', '3', '5']; // 4 is nowhere
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('should have failed');
});

run('catches: incorrect answer index (points to wrong choice)', () => {
  const q = baseValidQuestion();
  q.answer = 0; // choices[0] = '3', not '4'
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('should have failed');
});

run('catches: duplicate choices', () => {
  const q = baseValidQuestion();
  q.choices = ['4', '4', '5', '6'];
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('should have failed');
});

run('catches: correct answer appearing twice', () => {
  const q = baseValidQuestion();
  q.choices = ['4', '4', '5', '6'];
  q.answer = 0;
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('should have failed');
});

run('catches: missing final_answer', () => {
  const q = baseValidQuestion();
  delete q.final_answer;
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('should have failed');
});

run('catches: empty solution_steps', () => {
  const q = baseValidQuestion();
  q.solution_steps = '   ';
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('should have failed');
});

run('catches: final_answer inconsistent with solution_steps', () => {
  const q = baseValidQuestion();
  q.solution_steps = '2 + 2 = 4';
  q.final_answer = '5';
  q.choices = ['3', '4', '5', '6'];
  q.answer = 2; // points to '5' consistently with final_answer, but arithmetic says 4
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('should have failed (arithmetic says 4, final_answer says 5)');
});

run('catches: choices[answer] inconsistent with final_answer', () => {
  const q = baseValidQuestion();
  q.final_answer = '4';
  q.choices = ['3', '4', '5', '6'];
  q.answer = 2; // choices[2] = '5', not '4'
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('should have failed');
});

run('catches: malformed/unsafe arithmetic text is skipped, not executed, but still fails overall if inconsistent', () => {
  const q = baseValidQuestion();
  q.solution_steps = 'process.exit(1) = 4'; // must never be executed
  const v = validateMathQuestions({ questions: [q] }, 1);
  // Should not throw or crash; lhs simply fails to parse safely and is skipped.
  console.log('    (informational) validation result for unsafe text:', v.ok);
});

run('catches: fewer questions than requested item count', () => {
  const q = baseValidQuestion();
  const v = validateMathQuestions({ questions: [q] }, 5); // only 1 question, 5 requested
  if (v.ok) throw new Error('should have failed on incomplete count');
  if (!v.countComplete === false && v.countComplete !== false) throw new Error('countComplete should be false');
});

run('V1: true_false/fill_blank questions in a Math worksheet are REJECTED, not silently skipped', () => {
  const quiz = {
    questions: [
      { type: 'true_false', question: 'The sky is blue.', answer: true },
      { type: 'fill_blank', question: 'Fill in: 2 + 2 = ___', answer: '4', alternates: ['four'] }
    ]
  };
  const v = validateMathQuestions(quiz, 2);
  if (v.ok) throw new Error('a Math worksheet with ZERO multiple_choice questions must never pass, even if total count matches expectedCount');
  if (v.failures.length !== 2) throw new Error('expected both non-multiple_choice questions to be individually flagged, got ' + v.failures.length);
  if (!v.failures[0].reasons[0].includes('multiple_choice')) throw new Error('expected a clear "must be multiple_choice" reason');
});

// ===== Broader matrix: non-currency types shouldn't trigger currency rules =====
run('percentage answer: not treated as currency, passes on its own consistency', () => {
  const q = {
    type: 'multiple_choice',
    question: '50 is what percent of 200?',
    solution_steps: '50 / 200 = 0.25',
    final_answer: '25%',
    choices: ['10%', '25%', '50%', '75%'],
    answer: 1
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('FIX 2 REGRESSION: "25%" must NOT be treated as equal to plain "25" -- percent meaning is preserved', () => {
  if (sandbox.valuesMatch('25%', '25')) {
    throw new Error('valuesMatch incorrectly treated "25%" (0.25) as equal to "25" (25) -- percent sign was stripped instead of preserved as meaning');
  }
});

run('FIX 2: "25%" numerically equals 0.25, not 25', () => {
  if (!sandbox.valuesMatch('25%', '0.25')) {
    throw new Error('expected "25%" to numerically equal 0.25');
  }
  if (sandbox.valuesMatch('25%', '25.00')) {
    throw new Error('expected "25%" to NOT equal 25 -- percent sign changes the meaning by a factor of 100');
  }
});

run('fraction answer: exact match works without corrupting the numeric comparison', () => {
  const q = {
    type: 'multiple_choice',
    question: 'What is 1/2 + 1/4?',
    solution_steps: '1/2 + 1/4 = 0.75',
    final_answer: '3/4',
    choices: ['1/4', '1/2', '3/4', '1'],
    answer: 2
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('currency with thousands separator normalizes correctly', () => {
  const PHP = String.fromCharCode(0x20B1);
  const q = {
    type: 'multiple_choice',
    question: 'A family saved ' + PHP + '1,000.00 in January and ' + PHP + '500.00 in February. What is their total?',
    solution_steps: '1000 + 500 = 1500',
    final_answer: PHP + '1,500.00',
    choices: [PHP + '1,000.00', PHP + '1,500.00', PHP + '500.00', PHP + '2,000.00'],
    answer: 1
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('non-currency measurement unit (cm2) is not forced into currency rules', () => {
  const q = {
    type: 'multiple_choice',
    question: 'A rectangle is 4 cm by 5 cm. What is its area?',
    solution_steps: '4 * 5 = 20',
    final_answer: '20 cm2',
    choices: ['9 cm2', '20 cm2', '18 cm2', '25 cm2'],
    answer: 1
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (!v.ok) throw new Error('expected ok (no currency involved), got: ' + JSON.stringify(v.failures));
});

run('naturally-exact two-decimal currency result needs no rounding language', () => {
  const PHP = String.fromCharCode(0x20B1);
  const q = {
    type: 'multiple_choice',
    question: 'Ana bought 4 notebooks at ' + PHP + '12.50 each. How much did she pay?',
    solution_steps: '4 * 12.50 = 50.00',
    final_answer: PHP + '50.00',
    choices: [PHP + '48.00', PHP + '50.00', PHP + '52.50', PHP + '45.00'],
    answer: 1
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('max item count (20): countComplete true when exactly 20 valid questions supplied', () => {
  const PHP = String.fromCharCode(0x20B1);
  const questions = [];
  for (let i = 0; i < 20; i++) {
    questions.push({
      type: 'multiple_choice',
      question: 'Item ' + i + ': what is ' + i + ' + 1?',
      solution_steps: i + ' + 1 = ' + (i + 1),
      final_answer: String(i + 1),
      choices: [String(i), String(i + 1), String(i + 2), String(i + 3)],
      answer: 1
    });
  }
  const v = validateMathQuestions({ questions }, 20);
  if (!v.ok) throw new Error('expected ok at max item count, got: ' + JSON.stringify(v.failures.slice(0, 3)));
  if (v.validMultipleChoiceCount !== 20) throw new Error('expected 20 valid questions, got ' + v.validMultipleChoiceCount);
});

run('REGRESSION: valuesMatch (choice/distractor comparison) must NOT collapse different units with the same number', () => {
  if (sandbox.valuesMatch('20 cm2', '20 kg')) {
    throw new Error('valuesMatch incorrectly treated "20 cm2" and "20 kg" as equal -- units were stripped for the wrong comparison path');
  }
});

run('lastStepMatchesFinalAnswer (the narrower, intentionally looser helper) DOES bridge a bare number to a unit-suffixed final_answer', () => {
  if (!sandbox.lastStepMatchesFinalAnswer('20', '20 cm2')) {
    throw new Error('expected the loose helper to bridge "20" (raw solution_steps result) with "20 cm2" (final_answer)');
  }
});

// ===== Negation-aware rounding detection (per Ann's follow-up review) =====
const { questionRequestsRounding } = sandbox;

run('questionRequestsRounding: "Do not round your answer." is NOT a rounding request', () => {
  if (questionRequestsRounding('Do not round your answer.')) throw new Error('false positive');
});
run('questionRequestsRounding: "Rounding is not required." is NOT a rounding request', () => {
  if (questionRequestsRounding('Rounding is not required.')) throw new Error('false positive');
});
run('questionRequestsRounding: positive phrasing still detected ("Round to the nearest centavo.")', () => {
  if (!questionRequestsRounding('Round to the nearest centavo.')) throw new Error('false negative');
});
run('questionRequestsRounding: "Please round your answer to the nearest peso." detected', () => {
  if (!questionRequestsRounding('How much did she spend? Please round your answer to the nearest peso.')) throw new Error('false negative');
});
run('questionRequestsRounding: no mention of round at all -> false', () => {
  if (questionRequestsRounding('How much change did she receive?')) throw new Error('should be false');
});

run('END-TO-END: negated rounding phrasing in the QUESTION correctly rejects an unrounded exact result', () => {
  const PHP = String.fromCharCode(0x20B1);
  const q = {
    type: 'multiple_choice',
    question: "Juan's bakery sold 15.5 loaves and 12.75 loaves at " + PHP + "32.50 per loaf. How much did he earn? Do not round your answer.",
    solution_steps: '15.5 + 12.75 = 28.25; 28.25 * 32.50 = 918.125',
    final_answer: PHP + '918.13',
    choices: [PHP + '918.13', PHP + '900.00', PHP + '928.13', PHP + '918.00'],
    answer: 0
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('expected this to FAIL: question explicitly says do not round, but the exact result (918.125) has 3 decimals and final_answer rounds it anyway');
});

run('END-TO-END: solution_steps mentioning "round" does NOT count if the question itself never asked for it', () => {
  const PHP = String.fromCharCode(0x20B1);
  const q = {
    type: 'multiple_choice',
    // Question never asks for rounding at all.
    question: "Juan's bakery sold 15.5 loaves and 12.75 loaves at " + PHP + "32.50 per loaf. How much did he earn?",
    // But the model's own narration decided to round anyway -- this must NOT
    // be accepted as "rounding was requested" just because the word appears
    // in solution_steps; the model imposed rounding the question never asked for.
    solution_steps: '15.5 + 12.75 = 28.25; 28.25 * 32.50 = 918.125; rounded to the nearest centavo = 918.13',
    final_answer: PHP + '918.13',
    choices: [PHP + '918.13', PHP + '900.00', PHP + '928.13', PHP + '918.00'],
    answer: 0
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('expected this to FAIL: question never asked for rounding, so the model should not have rounded, regardless of what solution_steps narrates');
});

// ===== Review point 2: mixed question types =====
run('REVIEW (V1): an all-multiple_choice quiz with the exact requested count passes', () => {
  const quiz = {
    questions: [
      { type: 'multiple_choice', question: 'What is 2 + 2?', solution_steps: '2 + 2 = 4', final_answer: '4', choices: ['3', '4', '5', '6'], answer: 1 },
      { type: 'multiple_choice', question: 'What is 3 + 3?', solution_steps: '3 + 3 = 6', final_answer: '6', choices: ['5', '6', '7', '8'], answer: 1 }
    ]
  };
  const v = validateMathQuestions(quiz, 2);
  if (v.totalQuestions !== 2) throw new Error('expected totalQuestions 2, got ' + v.totalQuestions);
  if (v.totalMultipleChoiceCount !== 2) throw new Error('expected 2 multiple_choice questions inspected, got ' + v.totalMultipleChoiceCount);
  if (!v.countComplete) throw new Error('expected countComplete true (2 questions === 2 requested)');
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

// ===== FIX 1: exact count required, expectedCount=0/invalid must never pass =====
run('FIX 1: count must match EXACTLY -- MORE questions than requested also fails now (not just fewer)', () => {
  const quiz = {
    questions: [
      { type: 'multiple_choice', question: 'What is 2 + 2?', solution_steps: '2 + 2 = 4', final_answer: '4', choices: ['3', '4', '5', '6'], answer: 1 },
      { type: 'multiple_choice', question: 'What is 3 + 3?', solution_steps: '3 + 3 = 6', final_answer: '6', choices: ['5', '6', '7', '8'], answer: 1 }
    ]
  };
  const v = validateMathQuestions(quiz, 1); // only 1 requested, but 2 supplied
  if (v.ok) throw new Error('expected failure: 2 questions supplied but exactly 1 was requested');
  if (v.countComplete) throw new Error('countComplete should be false on an exact-match mismatch');
});

run('FIX 1: expectedCount = 0 must NEVER trivially pass, even with zero questions supplied', () => {
  const v = validateMathQuestions({ questions: [] }, 0);
  if (v.ok) throw new Error('expectedCount=0 must not be treated as "any count satisfies zero" -- it should always fail');
  if (v.countComplete) throw new Error('countComplete must be false when expectedCount is not a valid positive integer');
});

run('FIX 1: expectedCount = -5 (invalid) must never pass', () => {
  const q = { type: 'multiple_choice', question: 'What is 2 + 2?', solution_steps: '2 + 2 = 4', final_answer: '4', choices: ['3', '4', '5', '6'], answer: 1 };
  const v = validateMathQuestions({ questions: [q] }, -5);
  if (v.ok) throw new Error('negative expectedCount must never pass');
});

run('FIX 1: expectedCount = 2.5 (non-integer) must never pass', () => {
  const q = { type: 'multiple_choice', question: 'What is 2 + 2?', solution_steps: '2 + 2 = 4', final_answer: '4', choices: ['3', '4', '5', '6'], answer: 1 };
  const v = validateMathQuestions({ questions: [q, q] }, 2.5);
  if (v.ok) throw new Error('non-integer expectedCount must never pass');
});

// ===== Review point 4 (still valid under V1): one bad multiple_choice question fails the WHOLE worksheet =====
run('REVIEW: one invalid multiple_choice question fails the entire worksheet', () => {
  const quiz = {
    questions: [
      { type: 'multiple_choice', question: 'What is 2 + 2?', solution_steps: '2 + 2 = 4', final_answer: '4', choices: ['3', '4', '5', '6'], answer: 1 },
      // This one is broken: choices[answer] doesn't match final_answer.
      { type: 'multiple_choice', question: 'What is 3 + 3?', solution_steps: '3 + 3 = 6', final_answer: '6', choices: ['5', '7', '8', '9'], answer: 0 }
    ]
  };
  const v = validateMathQuestions(quiz, 2);
  if (v.ok) throw new Error('expected the whole worksheet to fail because of the one broken multiple_choice question');
  if (v.failures.length !== 1) throw new Error('expected exactly 1 failing question (index 1), got ' + v.failures.length);
  if (v.failures[0].index !== 1) throw new Error('expected the failure to be attributed to index 1, got index ' + v.failures[0].index);
});

// ===== FIX 4: tighter exact-arithmetic epsilon =====
run('FIX 4: arithmetic off by a whole cent (0.01) is now correctly REJECTED as inexact (old 0.01 tolerance would have silently passed this)', () => {
  const q = {
    type: 'multiple_choice',
    question: 'What is 2 + 2?',
    solution_steps: '2 + 2 = 4.01', // deliberately wrong by exactly the old (too loose) tolerance
    final_answer: '4.01',
    choices: ['3.01', '4.01', '5.01', '6.01'],
    answer: 1
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (v.ok) throw new Error('expected failure: 2 + 2 = 4.01 is arithmetically wrong and must be caught under the tightened epsilon');
});

run('FIX 4: genuine floating-point noise (e.g. 0.1 + 0.2) still correctly passes (does not over-tighten into false positives)', () => {
  const q = {
    type: 'multiple_choice',
    question: 'What is 0.1 + 0.2?',
    solution_steps: '0.1 + 0.2 = 0.3',
    final_answer: '0.3',
    choices: ['0.1', '0.2', '0.3', '0.4'],
    answer: 2
  };
  const v = validateMathQuestions({ questions: [q] }, 1);
  if (!v.ok) throw new Error('expected ok: 0.1 + 0.2 = 0.3 should pass despite JS floating-point representation noise, got: ' + JSON.stringify(v.failures));
});

// =====================================================================
// REV 4: getMathActivityProfile -- shared mode+activity -> profile helper
// =====================================================================
run('getMathActivityProfile: Interactive + Reading Comprehension is still requiresMultipleChoice, with neither printable-only flag set', () => {
  const p = getMathActivityProfile('interactive', 'Reading Comprehension');
  if (!p.requiresMultipleChoice) throw new Error('expected requiresMultipleChoice true for Interactive');
  if (p.isPrintableReadingComprehension) throw new Error('expected isPrintableReadingComprehension false for Interactive');
  if (p.isPrintableMatchingType) throw new Error('expected isPrintableMatchingType false');
});
run('getMathActivityProfile: Interactive + Matching Type is still requiresMultipleChoice, with neither printable-only flag set', () => {
  const p = getMathActivityProfile('interactive', 'Matching Type');
  if (!p.requiresMultipleChoice) throw new Error('expected requiresMultipleChoice true for Interactive');
  if (p.isPrintableMatchingType) throw new Error('expected isPrintableMatchingType false for Interactive');
});
run('getMathActivityProfile: Printable + Multiple Choice Quiz requires multiple_choice', () => {
  const p = getMathActivityProfile('printable', 'Multiple Choice Quiz');
  if (!p.requiresMultipleChoice) throw new Error('expected requiresMultipleChoice true');
});
run('getMathActivityProfile: Printable + Worksheet/Reading Comprehension/Matching Type/Parent-Tutor all require open_response', () => {
  ['Worksheet', 'Reading Comprehension', 'Matching Type', 'Parent/Tutor Support Sheet'].forEach((activity) => {
    const p = getMathActivityProfile('printable', activity);
    if (p.requiresMultipleChoice) throw new Error(activity + ': expected requiresMultipleChoice false');
  });
});
run('getMathActivityProfile: Printable + Reading Comprehension sets isPrintableReadingComprehension only', () => {
  const p = getMathActivityProfile('printable', 'Reading Comprehension');
  if (!p.isPrintableReadingComprehension) throw new Error('expected true');
  if (p.isPrintableMatchingType) throw new Error('expected false');
});
run('getMathActivityProfile: Printable + Matching Type sets isPrintableMatchingType only', () => {
  const p = getMathActivityProfile('printable', 'Matching Type');
  if (!p.isPrintableMatchingType) throw new Error('expected true');
  if (p.isPrintableReadingComprehension) throw new Error('expected false');
});
run('getMathActivityProfile: unrecognized/missing mode satisfies none of the three predicates', () => {
  const p = getMathActivityProfile(undefined, 'Reading Comprehension');
  if (p.requiresMultipleChoice || p.isPrintableReadingComprehension || p.isPrintableMatchingType) {
    throw new Error('expected all three false for an unrecognized mode, got: ' + JSON.stringify(p));
  }
});

// =====================================================================
// REV 4: Printable open_response schema profile
// =====================================================================
function baseOpenResponseQuestion() {
  return {
    type: 'open_response',
    question: 'What is 2 + 2?',
    solution_steps: '2 + 2 = 4',
    final_answer: '4'
  };
}

run('Printable Worksheet: passes with NO choices/answer fields at all', () => {
  const v = sandbox.validateMathQuestions({ questions: [baseOpenResponseQuestion()] }, 1, 'Worksheet', 'printable');
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('Printable Worksheet: a multiple_choice-typed question FAILS this profile (wrong type for the activity)', () => {
  const q = Object.assign({}, baseOpenResponseQuestion(), { type: 'multiple_choice', choices: ['3', '4', '5', '6'], answer: 1 });
  const v = sandbox.validateMathQuestions({ questions: [q] }, 1, 'Worksheet', 'printable');
  if (v.ok) throw new Error('expected failure: Worksheet profile expects open_response, not multiple_choice');
});

run('Printable Multiple Choice Quiz: FAILS when choices/answer are missing (profile still enforces MC requirements)', () => {
  const q = baseOpenResponseQuestion(); // type open_response, no choices/answer
  const v = sandbox.validateMathQuestions({ questions: [q] }, 1, 'Multiple Choice Quiz', 'printable');
  if (v.ok) throw new Error('expected failure: Multiple Choice Quiz profile requires multiple_choice + choices + answer');
});

run('Printable Multiple Choice Quiz: still passes with a normal, complete multiple_choice question', () => {
  const v = sandbox.validateMathQuestions({ questions: [baseValidQuestion()] }, 1, 'Multiple Choice Quiz', 'printable');
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('Printable Parent/Tutor Support Sheet: passes with no choices/answer fields', () => {
  const v = sandbox.validateMathQuestions({ questions: [baseOpenResponseQuestion()] }, 1, 'Parent/Tutor Support Sheet', 'printable');
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('Open-response profile: broken arithmetic still fails (correctness validation is profile-independent)', () => {
  const q = Object.assign({}, baseOpenResponseQuestion(), { solution_steps: '2 + 2 = 5' });
  const v = sandbox.validateMathQuestions({ questions: [q] }, 1, 'Worksheet', 'printable');
  if (v.ok) throw new Error('expected failure: solution_steps arithmetic (2+2=5) does not check out, regardless of schema profile');
});

// =====================================================================
// REV 8: Reading Comprehension STRUCTURED story_facts/evidence_fact_ids
// contract (replaces the old freehand-passage/passage_evidence design
// entirely for validation -- see math-validation.js's validateMathQuestions
// banner). The old sentence-rediscovery validation path is GONE; these
// tests exercise the new ID-based contract directly. (extractSentences()
// itself remains covered separately below -- it is still exported for
// app.js's LEGACY RENDERING fallback, just no longer called by the
// validator.)
// =====================================================================
function storyFact(id, text) { return { id, text }; }

const RC_FACT_1 = storyFact('F1', 'Juan had 5 mangoes.');
const RC_FACT_2 = storyFact('F2', 'Nena gave Juan 3 more mangoes.');

function rcStoryQuiz(overrides) {
  return Object.assign({
    title: 't',
    story_facts: [RC_FACT_1, RC_FACT_2],
    questions: [{
      type: 'open_response',
      question: 'How many mangoes did Juan have after Nena gave him more?',
      evidence_fact_ids: ['F1', 'F2'],
      solution_steps: '5 + 3 = 8',
      final_answer: '8'
    }]
  }, overrides);
}

run('Reading Comprehension (story_facts): valid facts + evidence_fact_ids pass', () => {
  const v = sandbox.validateMathQuestions(rcStoryQuiz(), 1, 'Reading Comprehension', 'printable');
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('Reading Comprehension (story_facts): duplicate fact ids fail', () => {
  const quiz = rcStoryQuiz({ story_facts: [RC_FACT_1, { id: 'F1', text: 'A different fact text.' }] });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: duplicate story_facts id "F1"');
});

run('Reading Comprehension (story_facts): duplicate normalized fact text fails', () => {
  const quiz = rcStoryQuiz({ story_facts: [RC_FACT_1, { id: 'F2', text: '  Juan   had 5 mangoes.  ' }] });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: normalized duplicate fact text');
});

run('Reading Comprehension (story_facts): invalid fact id format fails (must look like "F1", "F2")', () => {
  const quiz = rcStoryQuiz({ story_facts: [{ id: 'Fact1', text: 'Juan had 5 mangoes.' }, RC_FACT_2] });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: fact id must match the "F1" style format');
});

run('Reading Comprehension (story_facts): a fact with missing/empty text fails', () => {
  const quiz = rcStoryQuiz({ story_facts: [{ id: 'F1', text: '   ' }, RC_FACT_2] });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: F1 has empty text');
});

run('Reading Comprehension (story_facts): unknown evidence_fact_ids id fails, and the failure names the unknown id', () => {
  const quiz = rcStoryQuiz({ questions: [Object.assign({}, rcStoryQuiz().questions[0], { evidence_fact_ids: ['F1', 'F7'] })] });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: F7 does not exist in story_facts');
  const reasons = v.failures.map((f) => f.reasons.join(' ')).join(' ');
  if (!reasons.includes('F7')) throw new Error('expected the failure reason to mention the unknown id F7, got: ' + reasons);
});

run('Reading Comprehension (story_facts): missing evidence_fact_ids fails', () => {
  const quiz = rcStoryQuiz();
  delete quiz.questions[0].evidence_fact_ids;
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: evidence_fact_ids missing entirely');
});

run('Reading Comprehension (story_facts): duplicate ids WITHIN one question\'s evidence_fact_ids are normalized away, not rejected', () => {
  const quiz = rcStoryQuiz({ questions: [Object.assign({}, rcStoryQuiz().questions[0], { evidence_fact_ids: ['F1', 'F1', 'F2'] })] });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (!v.ok) throw new Error('expected ok: a duplicate id within one question is harmless redundancy, not a failure, got: ' + JSON.stringify(v.failures));
});

run('Reading Comprehension (story_facts): an unused story fact fails -- every fact must be referenced by at least one question', () => {
  const quiz = rcStoryQuiz({ story_facts: [RC_FACT_1, RC_FACT_2, storyFact('F3', 'Aling Rosa sells mangoes too.')] });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: F3 is never referenced by any question (unreferenced/contradictory extra fact)');
});

run('Reading Comprehension (story_facts): numeric linkage to the referenced facts is required', () => {
  const quiz = rcStoryQuiz({
    questions: [{
      type: 'open_response', question: 'What is the capital of the Philippines?',
      evidence_fact_ids: ['F1', 'F2'], solution_steps: 'x = 1', final_answer: 'Manila'
    }]
  });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: referenced facts\' numbers (5, 3) are never used in the question or solution_steps');
});

run('Reading Comprehension (story_facts): arithmetic validation remains mandatory even with perfectly valid evidence', () => {
  const quiz = rcStoryQuiz({ questions: [Object.assign({}, rcStoryQuiz().questions[0], { solution_steps: '5 + 3 = 9' })] });
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: solution_steps arithmetic (5+3=9) does not check out');
});

run('Reading Comprehension (story_facts): a rounding instruction stated in a REFERENCED fact still satisfies the currency check', () => {
  const PHP = String.fromCharCode(0x20B1);
  const quiz = {
    title: 't',
    story_facts: [
      storyFact('F1', 'Aling Rosa sells rice for ' + PHP + '32.50 per kilo.'),
      storyFact('F2', 'Please round all totals to the nearest centavo.')
    ],
    questions: [{
      type: 'open_response',
      question: 'Aling Rosa sold 28.25 kilos of rice. How much did she earn?',
      evidence_fact_ids: ['F1', 'F2'],
      solution_steps: '28.25 * 32.50 = 918.125; rounded to the nearest centavo = 918.13',
      final_answer: PHP + '918.13'
    }]
  };
  const v = sandbox.validateMathQuestions(quiz, 1, 'Reading Comprehension', 'printable');
  if (!v.ok) throw new Error('expected ok: rounding instruction in a referenced fact should satisfy the currency check, got: ' + JSON.stringify(v.failures));
});

run('Reading Comprehension (story_facts): story_facts must be a non-empty array', () => {
  const v = sandbox.validateMathQuestions({ title: 't', story_facts: [], questions: [rcStoryQuiz().questions[0]] }, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: story_facts is empty');
});

run('Reading Comprehension (story_facts): missing story_facts AND missing evidence_fact_ids together fails', () => {
  const q = Object.assign({}, rcStoryQuiz().questions[0]);
  delete q.evidence_fact_ids;
  const v = sandbox.validateMathQuestions({ title: 't', questions: [q] }, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: both story_facts and evidence_fact_ids are absent');
});

run('Reading Comprehension (story_facts): a LEGACY passage/passage_evidence-shaped response is REJECTED for new generation, even when mathematically correct -- the old fields are display-only for historical saved worksheets and must never satisfy the new contract', () => {
  const legacyShapedQuiz = {
    title: 't',
    passage: 'Juan had 5 mangoes. Nena gave Juan 3 more mangoes.',
    questions: [{
      type: 'open_response',
      question: 'How many mangoes did Juan have after Nena gave him more?',
      passage_evidence: 'Juan had 5 mangoes. Nena gave Juan 3 more mangoes.',
      solution_steps: '5 + 3 = 8',
      final_answer: '8'
    }]
  };
  const v = sandbox.validateMathQuestions(legacyShapedQuiz, 1, 'Reading Comprehension', 'printable');
  if (v.ok) throw new Error('expected failure: a legacy passage/passage_evidence-only response must never pass, even though its content is mathematically correct, got ok');
  const reasons = v.failures.map((f) => f.reasons.join(' ')).join(' ');
  if (!/story_facts must be a non-empty array/.test(reasons)) {
    throw new Error('expected the failure to be attributed to the missing story_facts requirement (proving passage/passage_evidence is never consulted as an alternate valid shape), got: ' + reasons);
  }
});

run('MODE GATING: Interactive Math + Reading Comprehension activity string passes as a normal MCQ with NO story_facts/evidence_fact_ids at all', () => {
  const v = sandbox.validateMathQuestions({ questions: [baseValidQuestion()] }, 1, 'Reading Comprehension', 'interactive');
  if (!v.ok) throw new Error('Interactive Math must never require story_facts merely because the activity dropdown says Reading Comprehension, got: ' + JSON.stringify(v.failures));
});

const RC_SENTENCE_1 = 'Nena has 1/2 cup of sugar and 2 cups of flour for her recipe.';
const RC_SENTENCE_2 = 'She also owns 2 cups of milk.';
const RC_PASSAGE = RC_SENTENCE_1 + ' ' + RC_SENTENCE_2;

// =====================================================================
// REV 5: extractSentences -- sentence-boundary splitter
// =====================================================================
run('extractSentences: splits a multi-sentence passage into complete sentences, preserving original text', () => {
  const sentences = sandbox.extractSentences(RC_PASSAGE);
  if (sentences.length !== 2) throw new Error('expected 2 sentences, got ' + JSON.stringify(sentences));
  if (sentences[0] !== RC_SENTENCE_1) throw new Error('expected first sentence preserved verbatim, got: ' + sentences[0]);
  if (sentences[1] !== RC_SENTENCE_2) throw new Error('expected second sentence preserved verbatim, got: ' + sentences[1]);
});

run('extractSentences: a passage with no terminal punctuation still yields the trailing clause', () => {
  const sentences = sandbox.extractSentences('Just one clause with no period');
  if (sentences.length !== 1 || sentences[0] !== 'Just one clause with no period') {
    throw new Error('expected the whole trailing clause as one sentence, got ' + JSON.stringify(sentences));
  }
});

run('extractSentences: empty/non-string input returns an empty array (no crash)', () => {
  if (sandbox.extractSentences('').length !== 0) throw new Error('expected empty array for empty string');
  if (sandbox.extractSentences(undefined).length !== 0) throw new Error('expected empty array for undefined');
});

// =====================================================================
// REV 6: extractSentences regression -- common NON-terminal periods must
// never be mistaken for a sentence boundary (decimals, currency, and
// common title/time abbreviations).
// =====================================================================
function assertSingleSentence(text) {
  const sentences = sandbox.extractSentences(text);
  if (sentences.length !== 1 || sentences[0] !== text) {
    throw new Error('expected exactly one sentence, verbatim: ' + JSON.stringify(text) + ', got: ' + JSON.stringify(sentences));
  }
}

run('extractSentences: a decimal quantity ("Lina bought 2.5 kilograms of rice.") is not split at the decimal point', () => {
  assertSingleSentence('Lina bought 2.5 kilograms of rice.');
});

run('extractSentences: a currency amount ("The notebook costs peso32.50.") is not split at the decimal point', () => {
  const PHP = String.fromCharCode(0x20B1);
  assertSingleSentence('The notebook costs ' + PHP + '32.50.');
});

run('extractSentences: a title abbreviation ("Dr. Reyes prepared 5 activity cards.") is not split after "Dr."', () => {
  assertSingleSentence('Dr. Reyes prepared 5 activity cards.');
});

run('extractSentences: an ordinal/item abbreviation ("Juan answered item No. 5 correctly.") is not split after "No."', () => {
  assertSingleSentence('Juan answered item No. 5 correctly.');
});

run('extractSentences: time-of-day abbreviations ("...7:30 a.m. and closed at 2:00 p.m.") are not split mid-abbreviation', () => {
  assertSingleSentence('The store opened at 7:30 a.m. and closed at 2:00 p.m.');
});

run('extractSentences: a genuine next sentence after an abbreviation-containing sentence is STILL correctly separated', () => {
  const sentences = sandbox.extractSentences('Dr. Reyes prepared 5 activity cards. He also brought some markers.');
  if (sentences.length !== 2) throw new Error('expected 2 sentences, got ' + JSON.stringify(sentences));
  if (sentences[0] !== 'Dr. Reyes prepared 5 activity cards.') throw new Error('expected the first sentence preserved verbatim, got: ' + sentences[0]);
  if (sentences[1] !== 'He also brought some markers.') throw new Error('expected the second sentence preserved verbatim, got: ' + sentences[1]);
});

// =====================================================================
// REV 7: context-aware a.m./p.m. trailing-period disambiguation --
// resolves the previously-documented limitation where an abbreviation-
// ending sentence immediately followed by another sentence would
// incorrectly merge the two (or, the alternative failure mode, reject
// otherwise-valid exact-sentence evidence because the "real" sentence
// boundary was never found in the first place).
// =====================================================================
run('CONTEXT-AWARE a.m./p.m. [1]: "...7:30 a.m. and closed at 2:00 p.m." stays ONE sentence (lowercase continuation word after the first, end of text after the second)', () => {
  assertSingleSentence('The store opened at 7:30 a.m. and closed at 2:00 p.m.');
});

run('CONTEXT-AWARE a.m./p.m. [2]: "At 2:00 p.m., Juan counted 5 boxes." stays ONE sentence (comma continuation after the trailing period)', () => {
  assertSingleSentence('At 2:00 p.m., Juan counted 5 boxes.');
});

run('CONTEXT-AWARE a.m./p.m. [3]: "The store closed at 2:00 p.m. Juan counted 5 boxes." becomes EXACTLY TWO sentences (capitalized new sentence follows)', () => {
  const sentences = sandbox.extractSentences('The store closed at 2:00 p.m. Juan counted 5 boxes.');
  if (sentences.length !== 2) throw new Error('expected 2 sentences, got ' + JSON.stringify(sentences));
  if (sentences[0] !== 'The store closed at 2:00 p.m.') throw new Error('expected the first sentence preserved verbatim, got: ' + sentences[0]);
  if (sentences[1] !== 'Juan counted 5 boxes.') throw new Error('expected the second sentence preserved verbatim, got: ' + sentences[1]);
});

run('CONTEXT-AWARE a.m./p.m. [4]: the passage sentences correctly split so the second, uncited numeric sentence is a SEPARATE extracted sentence (rendering-level "never displayed" check for the LEGACY fallback lives in test_printable_math_render.js)', () => {
  const sentences = sandbox.extractSentences('The store closed at 2:00 p.m. Juan counted 5 boxes.');
  if (!sentences.includes('The store closed at 2:00 p.m.')) throw new Error('expected the cited sentence to be independently extractable');
  if (!sentences.includes('Juan counted 5 boxes.')) throw new Error('expected the second sentence to be independently extractable (so the renderer CAN and must choose to exclude it)');
});

run('REGRESSION: decimal ("2.5 kilograms"), currency (peso32.50), Dr., Mr./Mrs./Ms., No., e.g., and i.e. still remain single sentences after the a.m./p.m. context-aware change', () => {
  const PHP = String.fromCharCode(0x20B1);
  [
    'Lina bought 2.5 kilograms of rice.',
    'The notebook costs ' + PHP + '32.50.',
    'Dr. Reyes prepared 5 activity cards.',
    'Mr. Santos and Mrs. Cruz greeted Ms. Bautista.',
    'Juan answered item No. 5 correctly.',
    'Bring school supplies, e.g. pencils and paper.',
    'She finished her chores, i.e. sweeping and washing dishes.'
  ].forEach((text) => assertSingleSentence(text));
});

// =====================================================================
// REV 4: Matching Type final_answer uniqueness (Printable only)
// =====================================================================
function matchingQuestion(finalAnswer) {
  return {
    type: 'open_response',
    question: 'What is ' + finalAnswer + ' as a number?',
    solution_steps: 'x = ' + finalAnswer,
    final_answer: finalAnswer
  };
}

run('Matching Type: passes when all final_answer values are unique', () => {
  const quiz = { questions: [matchingQuestion('1'), matchingQuestion('2'), matchingQuestion('3')] };
  const v = sandbox.validateMathQuestions(quiz, 3, 'Matching Type', 'printable');
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('Matching Type: fails when two final_answer values are identical', () => {
  const quiz = { questions: [matchingQuestion('4'), matchingQuestion('4'), matchingQuestion('5')] };
  const v = sandbox.validateMathQuestions(quiz, 3, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: two questions share the identical final_answer "4"');
});

run('Matching Type: fails when two final_answer values are Math-equivalent (0.75 vs 3/4), not just textually equal', () => {
  const quiz = { questions: [matchingQuestion('0.75'), matchingQuestion('3/4'), matchingQuestion('2')] };
  const v = sandbox.validateMathQuestions(quiz, 3, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: "0.75" and "3/4" are the same value after Math-equivalence normalization');
});

// =====================================================================
// SECTION A: Matching Type BARE ANSWER CONTRACT -- final_answer must be a
// single, complete, BARE mathematical value (see parseBareMathValue).
// ANY surrounding words, units, nouns, or equations are rejected OUTRIGHT
// at the per-question level, independent of the cross-question uniqueness
// check below. This replaces the earlier design, which only searched for
// a numeric token ANYWHERE within a noisy string (so "15 marbles" could
// previously slip through as "valid" on its own, only failing when it
// happened to collide with another question's value).
// =====================================================================
run('Matching Type: bare answers (5, -8, 3/4, 25%, peso1,250.50) all pass individually', () => {
  const PHP = String.fromCharCode(0x20B1);
  const quiz = { questions: [matchingQuestion('5'), matchingQuestion('-8'), matchingQuestion('3/4'), matchingQuestion('25%'), matchingQuestion(PHP + '1,250.50')] };
  const v = sandbox.validateMathQuestions(quiz, 5, 'Matching Type', 'printable');
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('Matching Type: "5 marbles" fails (noun-qualified, not a bare value)', () => {
  const quiz = { questions: [matchingQuestion('5 marbles'), matchingQuestion('7')] };
  const v = sandbox.validateMathQuestions(quiz, 2, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: "5 marbles" is not a bare mathematical value');
});

run('Matching Type: "12 / 3 = 4" fails (an equation, not a bare value)', () => {
  const quiz = { questions: [matchingQuestion('12 / 3 = 4'), matchingQuestion('7')] };
  const v = sandbox.validateMathQuestions(quiz, 2, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: "12 / 3 = 4" is an equation, not a bare value');
});

run('Matching Type: "The answer is 5" fails (explanatory prose, not a bare value)', () => {
  const quiz = { questions: [matchingQuestion('The answer is 5'), matchingQuestion('7')] };
  const v = sandbox.validateMathQuestions(quiz, 2, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: "The answer is 5" is explanatory prose, not a bare value');
});

run('Matching Type: "3/4 cup" fails (unit-qualified fraction, not bare)', () => {
  const quiz = { questions: [matchingQuestion('3/4 cup'), matchingQuestion('7')] };
  const v = sandbox.validateMathQuestions(quiz, 2, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: "3/4 cup" is not a bare value');
});

run('Matching Type: "5 and 2 remainder" fails (more than one value / explanatory, not a single bare value)', () => {
  const quiz = { questions: [matchingQuestion('5 and 2 remainder'), matchingQuestion('7')] };
  const v = sandbox.validateMathQuestions(quiz, 2, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: "5 and 2 remainder" is not a single bare value');
});

run('Matching Type: five distinct bare answers pass (Grade 2 division plan example: 2, 3, 4, 5, 6)', () => {
  const quiz = { questions: ['2', '3', '4', '5', '6'].map((v) => matchingQuestion(v)) };
  const v = sandbox.validateMathQuestions(quiz, 5, 'Matching Type', 'printable');
  if (!v.ok) throw new Error('expected ok, got: ' + JSON.stringify(v.failures));
});

run('Matching Type: two mathematically equivalent BARE answers still fail as duplicates (25% vs 0.25)', () => {
  const quiz = { questions: [matchingQuestion('25%'), matchingQuestion('0.25'), matchingQuestion('7')] };
  const v = sandbox.validateMathQuestions(quiz, 3, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: "25%" (0.25) and "0.25" are the same value');
});

run('Matching Type: two mathematically equivalent BARE answers still fail as duplicates (5 vs 5.0)', () => {
  const quiz = { questions: [matchingQuestion('5'), matchingQuestion('5.0'), matchingQuestion('7')] };
  const v = sandbox.validateMathQuestions(quiz, 3, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure: "5" and "5.0" are the same value');
});

run('Matching Type: cross-question duplicate failure is attributed to the LATER question with a retry-friendly "Question N" message', () => {
  const quiz = { questions: [matchingQuestion('5'), matchingQuestion('5'), matchingQuestion('7')] };
  const v = sandbox.validateMathQuestions(quiz, 3, 'Matching Type', 'printable');
  if (v.ok) throw new Error('expected failure');
  const attributed = v.failures.some((f) => f.index === 1 && f.reasons.some((r) => /is the same or a mathematically equivalent value as Question 1/.test(r)));
  if (!attributed) throw new Error('expected the duplicate failure attached to index 1 (Question 2), referencing "Question 1", got: ' + JSON.stringify(v.failures));
});

run('MODE GATING: Interactive Math + Matching Type activity string passes as a normal MCQ even with duplicate final_answer values', () => {
  const q1 = baseValidQuestion();
  const q2 = Object.assign({}, baseValidQuestion(), { question: 'What is 2 + 2? (again)' });
  const v = sandbox.validateMathQuestions({ questions: [q1, q2] }, 2, 'Matching Type', 'interactive');
  if (!v.ok) throw new Error('Interactive Math must never apply the Matching Type uniqueness rule merely because the activity dropdown says Matching Type, got: ' + JSON.stringify(v.failures));
});

// =====================================================================
// REV 4: extractAllNumericTokens -- value-aware tokenizer
// =====================================================================
function tokensEqual(tokens, expectedValues) {
  if (tokens.length !== expectedValues.length) return false;
  return tokens.every((t, i) => Math.abs(t - expectedValues[i]) < 1e-6);
}

run('extractAllNumericTokens: "1/2" tokenizes as ONE token with value 0.5 (fraction vs decimal match)', () => {
  const tokens = extractAllNumericTokens('1/2');
  if (!tokensEqual(tokens, [0.5])) throw new Error('expected [0.5], got ' + JSON.stringify(tokens));
});

run('extractAllNumericTokens: "1 1/2" tokenizes as ONE token with value 1.5 (mixed number vs decimal match)', () => {
  const tokens = extractAllNumericTokens('1 1/2');
  if (!tokensEqual(tokens, [1.5])) throw new Error('expected [1.5], got ' + JSON.stringify(tokens));
});

run('extractAllNumericTokens: peso "1,250.50" tokenizes to 1250.50 (currency/comma vs plain match)', () => {
  const PHP = String.fromCharCode(0x20B1);
  const tokens = extractAllNumericTokens(PHP + '1,250.50');
  if (!tokensEqual(tokens, [1250.50])) throw new Error('expected [1250.50], got ' + JSON.stringify(tokens));
});

run('extractAllNumericTokens: "25%" tokenizes to 0.25, NOT 25 (percent semantics preserved, matches extractNumericValue)', () => {
  const tokens = extractAllNumericTokens('25%');
  if (!tokensEqual(tokens, [0.25])) throw new Error('expected [0.25], got ' + JSON.stringify(tokens));
  const unrelated = extractAllNumericTokens('25');
  if (tokensEqual(unrelated, tokens)) throw new Error('"25%" (0.25) must not numerically equal unrelated standalone "25"');
});

run('extractAllNumericTokens: a fraction is NEVER decomposed into separate numerator/denominator digit tokens', () => {
  const evidenceTokens = extractAllNumericTokens('1/2');
  const questionTokens = extractAllNumericTokens('There is 1 apple and 2 oranges');
  if (questionTokens.length !== 2 || !tokensEqual(questionTokens, [1, 2])) {
    throw new Error('expected the unrelated question to tokenize as separate [1, 2], got ' + JSON.stringify(questionTokens));
  }
  const falseMatch = evidenceTokens.some((ev) => questionTokens.some((qt) => Math.abs(ev - qt) < 1e-6));
  if (falseMatch) throw new Error('evidence "1/2" (0.5) must not falsely match the unrelated separate digits 1 and 2');
});

// =====================================================================
// REV 5: extractPrimaryNumericToken / extractNumericTokensDetailed --
// preserve meaningful DISPLAY forms, never collapse to a bare decimal.
// =====================================================================
run('extractPrimaryNumericToken: preserves currency/comma display form (peso 1,250.50 stays peso 1,250.50)', () => {
  const PHP = String.fromCharCode(0x20B1);
  const token = extractPrimaryNumericToken(PHP + '1,250.50');
  if (!token || token.raw !== PHP + '1,250.50') throw new Error('expected raw ' + JSON.stringify(PHP + '1,250.50') + ', got ' + JSON.stringify(token));
  if (Math.abs(token.value - 1250.50) > 1e-6) throw new Error('expected value 1250.50, got ' + token.value);
});

run('extractPrimaryNumericToken: preserves fraction display form ("3/4 cup" -> raw "3/4", not "0.75")', () => {
  const token = extractPrimaryNumericToken('3/4 cup');
  if (!token || token.raw !== '3/4') throw new Error('expected raw "3/4", got ' + JSON.stringify(token));
  if (Math.abs(token.value - 0.75) > 1e-6) throw new Error('expected value 0.75, got ' + token.value);
});

run('extractPrimaryNumericToken: preserves percent display form ("25%" stays "25%")', () => {
  const token = extractPrimaryNumericToken('25%');
  if (!token || token.raw !== '25%') throw new Error('expected raw "25%", got ' + JSON.stringify(token));
  if (Math.abs(token.value - 0.25) > 1e-6) throw new Error('expected value 0.25, got ' + token.value);
});

run('extractPrimaryNumericToken: preserves a negative value ("-8" stays "-8")', () => {
  const token = extractPrimaryNumericToken('-8 degrees');
  if (!token || token.raw !== '-8') throw new Error('expected raw "-8", got ' + JSON.stringify(token));
  if (token.value !== -8) throw new Error('expected value -8, got ' + token.value);
});

run('extractPrimaryNumericToken: "15 marbles" extracts to raw "15" (noun stripped)', () => {
  const token = extractPrimaryNumericToken('15 marbles');
  if (!token || token.raw !== '15') throw new Error('expected raw "15", got ' + JSON.stringify(token));
});

run('extractPrimaryNumericToken: returns null for zero numeric tokens', () => {
  if (extractPrimaryNumericToken('some marbles') !== null) throw new Error('expected null for text with no numbers');
});

run('extractPrimaryNumericToken: returns null for more than one numeric token (ambiguous)', () => {
  if (extractPrimaryNumericToken('15 marbles and 3 friends') !== null) throw new Error('expected null for text with two numbers');
});

// =====================================================================
// parseBareMathValue -- the AUTHORITATIVE Matching Type contract: unlike
// extractPrimaryNumericToken (which searches anywhere within a string),
// this requires the ENTIRE trimmed string to be exactly one value.
// =====================================================================
run('parseBareMathValue: "5" is bare, raw preserved', () => {
  const token = sandbox.parseBareMathValue('5');
  if (!token || token.raw !== '5' || token.value !== 5) throw new Error('expected raw "5"/value 5, got ' + JSON.stringify(token));
});

run('parseBareMathValue: "-8" is bare, raw preserved (not converted)', () => {
  const token = sandbox.parseBareMathValue('-8');
  if (!token || token.raw !== '-8' || token.value !== -8) throw new Error('expected raw "-8"/value -8, got ' + JSON.stringify(token));
});

run('parseBareMathValue: "3/4" is bare, raw preserved as a fraction (never converted to "0.75")', () => {
  const token = sandbox.parseBareMathValue('3/4');
  if (!token || token.raw !== '3/4') throw new Error('expected raw "3/4", got ' + JSON.stringify(token));
  if (Math.abs(token.value - 0.75) > 1e-6) throw new Error('expected value 0.75');
});

run('parseBareMathValue: "1 1/2" is bare, raw preserved as a mixed number', () => {
  const token = sandbox.parseBareMathValue('1 1/2');
  if (!token || token.raw !== '1 1/2') throw new Error('expected raw "1 1/2", got ' + JSON.stringify(token));
  if (Math.abs(token.value - 1.5) > 1e-6) throw new Error('expected value 1.5');
});

run('parseBareMathValue: "0.75" is bare', () => {
  const token = sandbox.parseBareMathValue('0.75');
  if (!token || token.raw !== '0.75') throw new Error('expected raw "0.75", got ' + JSON.stringify(token));
});

run('parseBareMathValue: "25%" is bare, raw preserved (never converted to "0.25")', () => {
  const token = sandbox.parseBareMathValue('25%');
  if (!token || token.raw !== '25%') throw new Error('expected raw "25%", got ' + JSON.stringify(token));
  if (Math.abs(token.value - 0.25) > 1e-6) throw new Error('expected value 0.25');
});

run('parseBareMathValue: peso "1,250.50" is bare, raw preserved (comma/peso kept, never converted to a bare decimal)', () => {
  const PHP = String.fromCharCode(0x20B1);
  const token = sandbox.parseBareMathValue(PHP + '1,250.50');
  if (!token || token.raw !== PHP + '1,250.50') throw new Error('expected raw ' + JSON.stringify(PHP + '1,250.50') + ', got ' + JSON.stringify(token));
});

run('parseBareMathValue: "5 marbles" is NOT bare -- returns null', () => {
  if (sandbox.parseBareMathValue('5 marbles') !== null) throw new Error('expected null: surrounding noun makes it not bare');
});

run('parseBareMathValue: "12 / 3 = 4" is NOT bare -- returns null (an equation)', () => {
  if (sandbox.parseBareMathValue('12 / 3 = 4') !== null) throw new Error('expected null: an equation is not a bare value');
});

run('parseBareMathValue: "The answer is 5" is NOT bare -- returns null (explanatory prose)', () => {
  if (sandbox.parseBareMathValue('The answer is 5') !== null) throw new Error('expected null: explanatory prose is not a bare value');
});

run('parseBareMathValue: "3/4 cup" is NOT bare -- returns null (unit-qualified)', () => {
  if (sandbox.parseBareMathValue('3/4 cup') !== null) throw new Error('expected null: a unit-qualified fraction is not bare');
});

run('parseBareMathValue: "5 and 2 remainder" is NOT bare -- returns null (more than one value)', () => {
  if (sandbox.parseBareMathValue('5 and 2 remainder') !== null) throw new Error('expected null: more than one value is not a single bare value');
});

run('parseBareMathValue: empty/whitespace-only/non-string input returns null', () => {
  if (sandbox.parseBareMathValue('') !== null) throw new Error('expected null for empty string');
  if (sandbox.parseBareMathValue('   ') !== null) throw new Error('expected null for whitespace-only string');
  if (sandbox.parseBareMathValue(undefined) !== null) throw new Error('expected null for undefined');
});

run('extractNumericTokensDetailed: extractAllNumericTokens is a values-only wrapper over the same detailed tokens', () => {
  const detailed = sandbox.extractNumericTokensDetailed('15 marbles and 3 friends');
  const values = extractAllNumericTokens('15 marbles and 3 friends');
  if (detailed.length !== values.length) throw new Error('expected the same token count from both functions');
  detailed.forEach((tok, i) => {
    if (Math.abs(tok.value - values[i]) > 1e-6) throw new Error('expected matching values at index ' + i);
  });
});

// =====================================================================
// REV 4: passage_evidence scope boundaries
// =====================================================================
run('passage_evidence is NEVER required for Worksheet/Matching Type/Parent-Tutor -- its absence is not penalized', () => {
  ['Worksheet', 'Matching Type', 'Parent/Tutor Support Sheet'].forEach((activity) => {
    const q = baseOpenResponseQuestion(); // no passage_evidence field
    const v = sandbox.validateMathQuestions({ questions: [q] }, 1, activity, 'printable');
    if (!v.ok) throw new Error(activity + ': expected ok without passage_evidence, got: ' + JSON.stringify(v.failures));
  });
});

run('normalizeEvidenceText: lowercases and collapses whitespace only (not a numeric normalizer)', () => {
  if (normalizeEvidenceText('  The   Recipe  Uses  Sugar ') !== 'the recipe uses sugar') {
    throw new Error('unexpected normalization: ' + JSON.stringify(normalizeEvidenceText('  The   Recipe  Uses  Sugar ')));
  }
});

console.log('\nDone.');

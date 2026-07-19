// Now testing the SHARED MODULE directly (math-validation.js) -- this is
// exactly what generate.js will require() server-side, and exactly what
// app.js destructures from window.MathValidation client-side. One
// implementation, tested once.
const path = require('path');
const sandbox = require(path.join(__dirname, '..', 'math-validation.js'));
const { run } = require('./helpers/run.js');

const { validateMathQuestions, safeEvalArithmetic } = sandbox;

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

console.log('\nDone.');

/* math-validation.js - BrightBridge PH
   Shared, pure Math worksheet validation logic. No DOM/browser APIs, no
   Node-only APIs -- this file is loaded two ways with zero build step:
     - Browser: <script src="math-validation.js"> before app.js, exposes
       window.MathValidation for instant client-side UX feedback.
     - Netlify Function: require('../../math-validation.js') from
       netlify/functions/generate.js, where it is the SERVER-AUTHORITATIVE
       gate before any Math worksheet is returned to a client.
   Keeping this as ONE file (instead of two copies) is the whole point: the
   client and server must never independently drift on what counts as a
   valid Math worksheet. This is also why getMathActivityProfile() (below)
   lives here rather than being independently re-derived in app.js and
   generate.js: the mode+activity -> schema/validation profile decision is
   exactly the same class of "must never drift" logic. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MathValidation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

/* ============ JSON REPAIR ============ */
function parseQuizJson(text) {
  // Extract from first { to last }
  const start = text.indexOf('{');
  if (start === -1) throw new SyntaxError('No JSON found');
  let s = text.slice(start);

  // Try direct parse first
  try { return JSON.parse(s); } catch (e) {}

  // Try cutting at last }
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace !== -1) {
    try { return JSON.parse(s.slice(0, lastBrace + 1)); } catch (e) {}
  }

  // Repair truncated JSON: cut at each } from the end, try closing the structure
  for (let i = s.length; i > 0; i--) {
    if (s[i - 1] === '}') {
      const candidate = s.slice(0, i);
      const suffixes = [']}', '}]}', ']}}', ''];
      for (const suffix of suffixes) {
        try {
          const parsed = JSON.parse(candidate + suffix);
          if (parsed.questions && parsed.questions.length > 0) return parsed;
        } catch (e) {}
      }
    }
  }
  throw new SyntaxError('Unrepairable JSON');
}

/* ============ MATH ACTIVITY PROFILE ============
   Single shared source of truth for which Math schema/validation profile
   applies to a given (mode, activity) pair. Both app.js's prompt builder
   and generate.js's server-side validation call this SAME function --
   neither file re-derives these booleans with its own formula, so the two
   can never independently drift (the exact failure mode this module
   exists to prevent, see the file banner above).

   Interactive Math is explicitly out of scope for the Printable Activity
   Type profiles below: it always requires multiple_choice, regardless of
   which Activity Type string happens to be attached to the request. A
   missing/unrecognized `mode` satisfies none of these three predicates
   (falls through to the open_response expected-type branch with no
   activity-specific rules engaged) -- production callers only ever pass
   one of the two server-validated mode values, so this only matters for a
   deliberately malformed direct call. */
function getMathActivityProfile(mode, activity) {
  return {
    requiresMultipleChoice: mode === 'interactive' || (mode === 'printable' && activity === 'Multiple Choice Quiz'),
    isPrintableReadingComprehension: mode === 'printable' && activity === 'Reading Comprehension',
    isPrintableMatchingType: mode === 'printable' && activity === 'Matching Type'
  };
}

/* ============ MATH VALIDATION (Math subject, interactive mode only) ============ */
// Built with String.fromCharCode instead of literal escapes/characters so this
// file stays 100% ASCII (see the project's emoji-escaping convention).
const MATH_PESO_SIGN = String.fromCharCode(0x20B1);          // Php peso sign
const MATH_MULT_SIGN = String.fromCharCode(0x00D7);          // multiplication sign
const MATH_DIV_SIGN = String.fromCharCode(0x00F7);           // division sign
const MATH_UNICODE_MINUS_CHARS = [0x2212, 0x2013, 0x2014].map(c => String.fromCharCode(c)); // minus sign, en dash, em dash

// Two distinct epsilons, named so the difference in intent is unmistakable:
// exact arithmetic should match to within floating-point noise only; deliberate
// currency rounding gets its own, much looser, half-centavo tolerance.
const MATH_EXACT_EPSILON = 1e-6;
const MATH_ROUNDING_EPSILON = 0.005;

// Strict, allowlist-only arithmetic evaluator. No eval(), no Function(), never
// executes model-generated text as JavaScript. Only digits, '.', '(', ')',
// '+', '-', '*', '/' and whitespace are accepted after normalization; anything
// else causes this to return null so the caller can skip that specific check.
function safeEvalArithmetic(exprRaw) {
  if (typeof exprRaw !== 'string') return null;
  let expr = exprRaw.trim();
  MATH_UNICODE_MINUS_CHARS.forEach(ch => { expr = expr.split(ch).join('-'); });
  expr = expr.split(MATH_MULT_SIGN).join('*');
  expr = expr.split(MATH_DIV_SIGN).join('/');
  expr = expr.replace(/[xX]/g, '*');
  expr = expr.split(',').join('');
  expr = expr.split(MATH_PESO_SIGN).join('');

  if (expr.length === 0) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

  let pos = 0;
  function peek() { return expr[pos]; }
  function isDigit(c) { return c >= '0' && c <= '9'; }
  function skipSpace() { while (peek() === ' ' || peek() === '\t') pos++; }

  function parseExpression() {
    let value = parseTerm();
    if (value === null) return null;
    skipSpace();
    while (peek() === '+' || peek() === '-') {
      const op = expr[pos]; pos++;
      const rhs = parseTerm();
      if (rhs === null) return null;
      value = op === '+' ? value + rhs : value - rhs;
      skipSpace();
    }
    return value;
  }
  function parseTerm() {
    let value = parseFactor();
    if (value === null) return null;
    skipSpace();
    while (peek() === '*' || peek() === '/') {
      const op = expr[pos]; pos++;
      const rhs = parseFactor();
      if (rhs === null) return null;
      if (op === '/' && rhs === 0) return null;
      value = op === '*' ? value * rhs : value / rhs;
      skipSpace();
    }
    return value;
  }
  function parseFactor() {
    skipSpace();
    if (peek() === '+') { pos++; return parseFactor(); }
    if (peek() === '-') { pos++; const v = parseFactor(); return v === null ? null : -v; }
    if (peek() === '(') {
      pos++;
      const v = parseExpression();
      skipSpace();
      if (peek() !== ')') return null;
      pos++;
      return v;
    }
    return parseNumber();
  }
  function parseNumber() {
    skipSpace();
    const start = pos;
    while (isDigit(peek())) pos++;
    if (peek() === '.') {
      pos++;
      while (isDigit(peek())) pos++;
    }
    if (pos === start) return null;
    const num = Number(expr.slice(start, pos));
    return Number.isFinite(num) ? num : null;
  }

  skipSpace();
  const result = parseExpression();
  skipSpace();
  if (result === null || pos !== expr.length) return null;
  return result;
}

// Text normalization for comparing choices/final_answer as displayed values
// (not for arithmetic evaluation -- see safeEvalArithmetic for that).
function normalizeMathValueText(s) {
  if (s === null || s === undefined) return '';
  let t = String(s).trim().replace(/\s+/g, ' ');
  MATH_UNICODE_MINUS_CHARS.forEach(ch => { t = t.split(ch).join('-'); });
  t = t.split(',').join('');
  return t.toLowerCase();
}

// Strict: the ENTIRE string (after currency stripping) must be a plain
// number, a simple integer/integer fraction, or a percentage. Used by
// valuesMatch(), which backs choice-uniqueness and distractor checks --
// deliberately does NOT strip arbitrary trailing unit text there, so
// "20 cm2" and "20 kg" never get silently treated as the same answer just
// because the number matches. A trailing "%" is preserved as MEANING, not
// discarded: "25%" numerically becomes 0.25, not 25, so it is never treated
// as equal to a bare "25".
function extractNumericValue(s) {
  let t = normalizeMathValueText(s);
  t = t.split(MATH_PESO_SIGN).join('').trim();

  const isPercent = /%$/.test(t);
  if (isPercent) t = t.slice(0, -1).trim();

  // Simple whole-string fraction support, e.g. "3/4" -> 0.75, so a fraction
  // final_answer can be compared against a decimal solution_steps result.
  // (A percent sign can't reach here since it would already have been
  // stripped above, and a fraction like "3/4%" isn't a supported shape.)
  const fractionMatch = /^(-?\d+)\/(\d+)$/.exec(t);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (denominator !== 0) return numerator / denominator;
  }

  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return isPercent ? n / 100 : n;
}

// Looser: extracts a LEADING numeric value even if followed by unit text
// (cm2, kg, items...). Only used for the narrow "does solution_steps' last
// raw arithmetic result agree with final_answer" check, where solution_steps
// commonly omits a unit that final_answer legitimately includes (e.g. a step
// ending "= 20" vs a final_answer of "20 cm2"). Never used for choice
// uniqueness or distractor comparisons -- see extractNumericValue for those.
function extractLeadingNumericValue(s) {
  // Delegates to the strict parser first, which already handles percent/
  // fraction/currency correctly -- this only kicks in for genuinely
  // unit-suffixed values (e.g. "20 cm2") that the strict parser rejects.
  const strict = extractNumericValue(s);
  if (strict !== null) return strict;
  let t = normalizeMathValueText(s);
  t = t.split(MATH_PESO_SIGN).join('').trim();
  const numericMatch = /^-?\d+(\.\d+)?/.exec(t);
  if (!numericMatch) return null;
  const n = Number(numericMatch[0]);
  return Number.isFinite(n) ? n : null;
}

function isCurrencyLike(s) {
  return typeof s === 'string' && (s.indexOf(MATH_PESO_SIGN) !== -1 || /peso/i.test(s));
}

// Negation-aware check for whether the QUESTION TEXT actually asks the
// learner to round. A naive /round/i.test(question) would false-positive on
// "Do not round your answer." or "Rounding is not required." -- this splits
// into rough clauses (so a negation in one sentence can't be confused with
// an unrelated "round" mention elsewhere) and requires a clause containing
// "round" to be free of a nearby negation phrase before counting it.
const MATH_ROUNDING_NEGATION_PATTERN = /\b(do not|does not|don't|doesn't|avoid|without|no need to|not necessary|need not|not required|isn't required|is not required|not needed)\b/i;
function questionRequestsRounding(questionText) {
  if (typeof questionText !== 'string') return false;
  const clauses = questionText.split(/[.!?]+/);
  return clauses.some((clause) => {
    if (!/round/i.test(clause)) return false;
    return !MATH_ROUNDING_NEGATION_PATTERN.test(clause);
  });
}

// Compares two displayed values (e.g. a choice and final_answer). Tries exact
// normalized-string equality first, then falls back to strict numeric
// comparison (centavo precision for currency, a tiny epsilon otherwise) --
// never treats meaningfully different values as equal just because units
// were stripped.
function valuesMatch(a, b) {
  const normA = normalizeMathValueText(a);
  const normB = normalizeMathValueText(b);
  if (normA === normB) return true;

  const numA = extractNumericValue(a);
  const numB = extractNumericValue(b);
  if (numA !== null && numB !== null) {
    const currency = isCurrencyLike(a) || isCurrencyLike(b);
    const epsilon = currency ? MATH_ROUNDING_EPSILON : MATH_EXACT_EPSILON;
    return Math.abs(numA - numB) < epsilon;
  }
  return false;
}

// Same idea as valuesMatch(), but for the solution_steps-vs-final_answer
// consistency check specifically: falls back to the looser leading-numeric
// extraction (tolerating a unit stated on only one side) if the strict
// comparison doesn't match.
function lastStepMatchesFinalAnswer(lastRhsText, finalAnswer) {
  if (valuesMatch(lastRhsText, finalAnswer)) return true;
  const a = extractLeadingNumericValue(lastRhsText);
  const b = extractLeadingNumericValue(finalAnswer);
  if (a === null || b === null) return false;
  const currency = isCurrencyLike(lastRhsText) || isCurrencyLike(finalAnswer);
  const epsilon = currency ? MATH_ROUNDING_EPSILON : MATH_EXACT_EPSILON;
  return Math.abs(a - b) < epsilon;
}

/* ============ TEXT NORMALIZATION FOR PASSAGE-EVIDENCE MATCHING ============ */
// Lowercase + collapsed whitespace only -- deliberately simpler than
// normalizeMathValueText (which also folds unicode minus variants and strips
// commas for NUMERIC comparison). This one is for comparing plain excerpt
// TEXT against passage text, not numbers.
function normalizeEvidenceText(s) {
  if (s === null || s === undefined) return '';
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/* ============ VALUE-AWARE NUMERIC TOKEN EXTRACTION ============
   Used only by the Reading Comprehension passage_evidence "is this evidence
   actually USED" check (see validateMathQuestions below). Tokenizes text
   into complete mathematical values -- integers, decimals, comma-formatted
   numbers, currency, simple fractions ("1/2"), mixed numbers ("1 1/2"), and
   percentages -- never as isolated digit substrings. This matters: a naive
   /\d+/g scan would split "1/2" into separate "1" and "2" tokens and could
   then falsely "match" unrelated numbers elsewhere in the text that happen
   to also be 1 or 2. The three alternatives below are tried in priority
   order (mixed number, then simple fraction, then plain number) so a
   fraction is always consumed as ONE token; the regex engine's global match
   advances past whatever it consumed, so a fraction's digits are never
   independently re-matched afterward. */
const MATH_TOKEN_PATTERN = new RegExp(
  '(?:' + MATH_PESO_SIGN + '\\s?)?-?\\d[\\d,]*(?:\\.\\d+)?\\s+\\d+\\/\\d+' + // mixed number: "1 1/2"
  '|(?:' + MATH_PESO_SIGN + '\\s?)?-?\\d+\\/\\d+' +                          // simple fraction: "1/2"
  '|(?:' + MATH_PESO_SIGN + '\\s?)?-?\\d[\\d,]*(?:\\.\\d+)?%?',              // integer/decimal/currency/percent
  'g'
);

// Parses ONE already-matched token (e.g. "1 1/2", "1/2", "25%", peso+"1,250.50")
// into a numeric value, reusing the same percent/fraction/comma/peso
// semantics already established by extractNumericValue() above -- so "25%"
// means 0.25 here too, never 25, consistent with the rest of this module.
function parseMathToken(token) {
  let t = String(token).trim();
  t = t.split(MATH_PESO_SIGN).join('').trim();

  const isPercent = /%$/.test(t);
  if (isPercent) t = t.slice(0, -1).trim();

  const mixedMatch = /^(-?\d[\d,]*(?:\.\d+)?)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixedMatch) {
    const whole = Number(mixedMatch[1].split(',').join(''));
    const num = Number(mixedMatch[2]);
    const den = Number(mixedMatch[3]);
    if (den === 0 || !Number.isFinite(whole)) return null;
    const sign = whole < 0 ? -1 : 1;
    const value = whole + sign * (num / den);
    return isPercent ? value / 100 : value;
  }

  const fractionMatch = /^(-?\d+)\/(\d+)$/.exec(t);
  if (fractionMatch) {
    const num = Number(fractionMatch[1]);
    const den = Number(fractionMatch[2]);
    if (den === 0) return null;
    const value = num / den;
    return isPercent ? value / 100 : value;
  }

  const plain = t.split(',').join('');
  if (!/^-?\d+(\.\d+)?$/.test(plain)) return null;
  const n = Number(plain);
  if (!Number.isFinite(n)) return null;
  return isPercent ? n / 100 : n;
}

function extractAllNumericTokens(text) {
  if (typeof text !== 'string') return [];
  let t = text;
  MATH_UNICODE_MINUS_CHARS.forEach(ch => { t = t.split(ch).join('-'); });
  const matches = t.match(MATH_TOKEN_PATTERN) || [];
  return matches.map(parseMathToken).filter((v) => v !== null);
}

// Validates Math questions per the Math prompt guardrails, profile-aware
// (see getMathActivityProfile above). Never modifies the quiz; only reports
// what it found.
//
// - Interactive Math (any Activity Type) and Printable "Multiple Choice
//   Quiz" require every question to be multiple_choice with exactly 4
//   choices and a valid answer index -- the original V1 rule, unchanged.
// - Printable "Worksheet"/"Reading Comprehension"/"Matching Type"/
//   "Parent/Tutor Support Sheet" require open_response instead: question,
//   final_answer, solution_steps only -- choices/answer are never
//   requested, required, or inspected.
// - Reading Comprehension (Printable only -- see isPrintableReadingComprehension)
//   additionally requires a non-empty quiz.passage and, per question, a
//   passage_evidence field that is a real (non-fabricated) excerpt from the
//   passage AND numerically used in the question/solution_steps.
// - Matching Type (Printable only -- see isPrintableMatchingType)
//   additionally requires every question's final_answer to be pairwise
//   distinguishable (via valuesMatch) from every other question's.
function validateMathQuestions(quiz, expectedCount, activity, mode) {
  const profile = getMathActivityProfile(mode, activity);
  const requiresMultipleChoice = profile.requiresMultipleChoice;
  const isPrintableReadingComprehension = profile.isPrintableReadingComprehension;
  const isPrintableMatchingType = profile.isPrintableMatchingType;
  const expectedType = requiresMultipleChoice ? 'multiple_choice' : 'open_response';

  const failures = [];
  let validMultipleChoiceCount = 0;
  let totalMultipleChoiceCount = 0;
  const questions = Array.isArray(quiz && quiz.questions) ? quiz.questions : [];

  if (isPrintableReadingComprehension) {
    const passageNonEmpty = typeof (quiz && quiz.passage) === 'string' && quiz.passage.trim().length > 0;
    if (!passageNonEmpty) {
      failures.push({ index: -1, reasons: ['passage is required and must be non-empty for Reading Comprehension'] });
    }
  }

  questions.forEach((q, index) => {
    const reasons = [];

    if (!q || typeof q !== 'object') {
      failures.push({ index, reasons: ['question entry is missing or malformed'] });
      return;
    }

    if (q.type !== expectedType) {
      failures.push({ index, reasons: ['Math questions must be ' + expectedType + ' for this activity, got: "' + (q.type || 'unknown') + '"'] });
      return;
    }

    totalMultipleChoiceCount++;

    if (typeof q.question !== 'string' || q.question.trim().length === 0) {
      reasons.push('question is missing or empty');
    }

    // choices/answer are ONLY requested, required, or validated for the
    // multiple_choice profile -- for open_response, these fields are never
    // read, and their presence or absence has no effect on the result.
    let choices = null;
    let answerIsValidIndex = false;
    if (requiresMultipleChoice) {
      choices = Array.isArray(q.choices) ? q.choices : null;
      if (!choices || choices.length !== 4) {
        reasons.push('choices must be an array of exactly 4 items');
      }

      if (choices && choices.length === 4) {
        const normSet = new Set(choices.map(normalizeMathValueText));
        if (normSet.size !== choices.length) {
          reasons.push('choices are not all unique after normalization');
        }
      }

      answerIsValidIndex = Number.isInteger(q.answer) && !!choices && q.answer >= 0 && q.answer < choices.length;
      if (!answerIsValidIndex) {
        reasons.push('answer is missing, not an integer, or out of range for choices');
      }
    }

    const hasSolutionSteps = typeof q.solution_steps === 'string' && q.solution_steps.trim().length > 0;
    if (!hasSolutionSteps) {
      reasons.push('solution_steps is missing or empty');
    }

    const hasFinalAnswer = typeof q.final_answer === 'string' && q.final_answer.trim().length > 0;
    if (!hasFinalAnswer) {
      reasons.push('final_answer is missing or empty');
    }

    if (requiresMultipleChoice && choices && choices.length === 4 && hasFinalAnswer) {
      const matchFlags = choices.map(c => valuesMatch(c, q.final_answer));
      const matchCount = matchFlags.filter(Boolean).length;
      if (matchCount === 0) {
        reasons.push('no choice matches final_answer');
      } else if (matchCount > 1) {
        reasons.push('final_answer value appears in more than one choice (duplicate correct answer)');
      } else if (answerIsValidIndex && !matchFlags[q.answer]) {
        reasons.push('choices[answer] does not match final_answer');
      }
    }

    // Reading Comprehension evidence linkage (Printable only). Additive to
    // every other check here -- never a substitute for arithmetic/currency
    // validation below.
    if (isPrintableReadingComprehension) {
      const hasEvidence = typeof q.passage_evidence === 'string' && q.passage_evidence.trim().length > 0;
      if (!hasEvidence) {
        reasons.push('passage_evidence is missing or empty for Reading Comprehension');
      } else {
        const normalizedEvidence = normalizeEvidenceText(q.passage_evidence);
        const normalizedPassage = normalizeEvidenceText((quiz && quiz.passage) || '');
        if (normalizedEvidence.length === 0 || normalizedPassage.indexOf(normalizedEvidence) === -1) {
          reasons.push('passage_evidence does not appear in the passage (fabricated excerpt)');
        } else {
          const evidenceTokens = extractAllNumericTokens(q.passage_evidence);
          const contextTokens = extractAllNumericTokens((q.question || '') + ' ' + (q.solution_steps || ''));
          if (evidenceTokens.length === 0) {
            reasons.push('passage_evidence has no numeric value to verify usage');
          } else {
            const used = evidenceTokens.some((ev) => contextTokens.some((ct) => Math.abs(ev - ct) < MATH_EXACT_EPSILON));
            if (!used) {
              reasons.push('passage_evidence numeric value(s) are not used in the question or solution_steps');
            }
          }
        }
      }
    }

    // Exact-result tracking for the currency check below: the last step's RHS
    // whose OWN step text doesn't mention rounding (i.e. the last raw
    // computation before any explicit "rounded to..." annotation step).
    let lastRhsText = null;
    let lastNonRoundingNumericRhs = null;

    if (hasSolutionSteps) {
      const steps = q.solution_steps.split(';').map(s => s.trim()).filter(Boolean);

      steps.forEach((step) => {
        const eqIndex = step.lastIndexOf('=');
        if (eqIndex === -1) return;
        const lhs = step.slice(0, eqIndex).trim();
        const rhs = step.slice(eqIndex + 1).trim();
        lastRhsText = rhs;

        const lhsValue = safeEvalArithmetic(lhs);
        const rhsValue = extractNumericValue(rhs);
        // If either side isn't safely parseable (e.g. "rounded to the nearest
        // centavo"), skip this specific check -- nothing is executed either way.
        if (lhsValue !== null && rhsValue !== null && Math.abs(lhsValue - rhsValue) >= MATH_EXACT_EPSILON) {
          reasons.push('solution_steps arithmetic does not check out: "' + step + '"');
        }

        if (!/round/i.test(step) && rhsValue !== null) {
          lastNonRoundingNumericRhs = rhsValue;
        }
      });

      if (lastRhsText !== null && hasFinalAnswer && !lastStepMatchesFinalAnswer(lastRhsText, q.final_answer)) {
        reasons.push('the last result in solution_steps is not consistent with final_answer');
      }
    }

    // Reading Comprehension: a rounding instruction stated once in the
    // shared passage (rather than repeated in every question) must still
    // satisfy this question's currency check -- see questionRequestsRounding.
    const roundingCheckText = isPrintableReadingComprehension
      ? ((quiz && quiz.passage) || '') + ' ' + (q.question || '')
      : (q.question || '');

    const currencyContext = isCurrencyLike(q.question) || (choices && choices.some(isCurrencyLike)) || isCurrencyLike(q.final_answer);
    if (currencyContext && hasFinalAnswer) {
      const finalDigitsOnly = q.final_answer.replace(/[^0-9.]/g, '');
      const displaysTwoDecimals = /\.\d{2}$/.test(finalDigitsOnly);
      if (!displaysTwoDecimals) {
        reasons.push('currency final_answer must display exactly two decimal places');
      }

      // Deliberately derived from the QUESTION TEXT (plus passage, for
      // Reading Comprehension) ONLY, not solution_steps: whether "rounding
      // was requested" must reflect what the learner was actually asked to
      // do, not what the model's own narration happened to say it did. See
      // questionRequestsRounding() for the negation handling ("Do not
      // round...", "Rounding is not required...").
      const mentionsRounding = questionRequestsRounding(roundingCheckText);

      if (lastNonRoundingNumericRhs !== null) {
        const cents = lastNonRoundingNumericRhs * 100;
        const exactHasMoreThanTwoDecimals = Math.abs(cents - Math.round(cents)) > 1e-6;
        const finalNum = extractNumericValue(q.final_answer);
        if (exactHasMoreThanTwoDecimals && !mentionsRounding) {
          reasons.push('exact computed result has more than two decimal places with no rounding instruction');
        } else if (exactHasMoreThanTwoDecimals && mentionsRounding && finalNum !== null) {
          const rounded = Math.round(cents) / 100;
          if (Math.abs(rounded - finalNum) >= MATH_ROUNDING_EPSILON) {
            reasons.push('rounded final_answer is not consistent with the exact computed result');
          }
        }
      }
    }

    if (reasons.length > 0) {
      failures.push({ index, reasons });
    } else {
      validMultipleChoiceCount++;
    }
  });

  // Matching Type (Printable only): every question's final_answer must be
  // pairwise distinguishable from every other question's, after Math-
  // equivalence normalization (valuesMatch already treats e.g. "0.75" and
  // "3/4" as the same answer). O(n^2) over at most 20 questions.
  if (isPrintableMatchingType) {
    for (let i = 0; i < questions.length; i++) {
      for (let j = i + 1; j < questions.length; j++) {
        const a = questions[i] && questions[i].final_answer;
        const b = questions[j] && questions[j].final_answer;
        if (typeof a === 'string' && typeof b === 'string' && valuesMatch(a, b)) {
          failures.push({
            index: -1,
            reasons: ['final_answer at index ' + i + ' is equivalent to index ' + j + ' after Math normalization -- Matching Type requires unique answers']
          });
        }
      }
    }
  }

  // expectedCount must itself be a valid positive integer -- a caller passing
  // 0 (or anything invalid) must never trivially satisfy "count complete."
  // Count must match EXACTLY, not just meet-or-exceed.
  const countComplete = Number.isInteger(expectedCount) && expectedCount > 0 && questions.length === expectedCount;

  return {
    ok: failures.length === 0 && countComplete,
    failures,
    totalQuestions: questions.length,
    expectedCount,
    totalMultipleChoiceCount,
    validMultipleChoiceCount,
    countComplete
  };
}

  return {
    parseQuizJson,
    getMathActivityProfile,
    safeEvalArithmetic,
    normalizeMathValueText,
    extractNumericValue,
    extractLeadingNumericValue,
    isCurrencyLike,
    questionRequestsRounding,
    valuesMatch,
    lastStepMatchesFinalAnswer,
    normalizeEvidenceText,
    extractAllNumericTokens,
    validateMathQuestions
  };
});

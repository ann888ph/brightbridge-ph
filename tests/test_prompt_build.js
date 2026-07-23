// Tests the REAL prompt-building logic inside app.js's generateWorksheet()
// by actually executing it (via Node vm, with a controlled fake DOM/fetch/
// Supabase stub) and capturing the prompt the real production code
// generates and sends to /.netlify/functions/generate -- NOT a hand-copied
// re-implementation, NOT a line-number-extracted snapshot of app.js. If
// generateWorksheet() is ever restructured, these tests exercise whatever
// the real function does today, automatically.
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

// Runs the REAL generateWorksheet() end-to-end up to the point where it
// calls fetch("/.netlify/functions/generate", ...), captures the exact
// `prompt` field it sent, then lets the request "fail" (our fake fetch
// returns a stubbed error) so the function exits cleanly through its own
// existing try/catch/finally -- no production code is skipped or altered
// to make this possible.
async function buildPromptViaRealApp(options) {
  options = options || {};
  let capturedPrompt = null;

  const values = Object.assign({
    grade: 'Grade 4', quarter: 'Quarter 1', subject: 'English',
    topic: 'Sample Topic', activity: 'Multiple Choice Quiz',
    items: '10', difficulty: 'Standard'
  }, options.values);

  // app.js calls initAuth() unconditionally at load time (bottom of the
  // file), which -- if getSession() returns a truthy session -- cascades
  // into showApp() -> loadWorksheets()/loadPlanAndUsage(), none of which
  // this test needs or wants to stub out. So: the FIRST getSession() call
  // (the bootstrap one from initAuth()) returns no session, skipping that
  // cascade entirely; every call AFTER that (the one generateWorksheet()
  // itself makes) returns a real, well-formed session so the function
  // proceeds to the fetch() call we actually want to observe.
  let getSessionCalls = 0;
  const fakeSession = { access_token: 'fake-token', user: { id: 'user-1', email: 'test@example.com' } };

  const sandbox = createAppSandbox({
    document: makeDocument({ values, checkedIds: options.checkedIds || [] }),
    fetch: async (url, opts) => {
      capturedPrompt = JSON.parse(opts.body).prompt;
      // Any non-429 response with an `error` field makes generateWorksheet()
      // throw internally (`if (data.error) throw new Error(data.error)`),
      // which its own try/catch already handles by showing an error message
      // -- we only need the prompt, already captured above by this point.
      return { ok: true, status: 200, json: async () => ({ error: 'test-harness: stop here on purpose' }) };
    },
    window: {
      supabase: {
        createClient: () => ({
          auth: {
            getSession: async () => {
              getSessionCalls++;
              return { data: { session: getSessionCalls === 1 ? null : fakeSession } };
            },
            onAuthStateChange: () => {}
          },
          from: () => ({})
        })
      }
    },
    // Module-level `let` bindings (wsMode, topicSource, activeCustomTopic)
    // are NOT reachable as writable sandbox properties from outside the vm
    // context -- Node's vm module exposes top-level `var`/function
    // declarations as global-object properties, but `let`/`const` bindings
    // live in a separate lexical scope. A bridge FUNCTION (itself exposed
    // like `var`) is required to reassign them from outside.
    extraCode: `
function __test_setModuleState(opts) {
  if (opts.wsMode !== undefined) wsMode = opts.wsMode;
  if (opts.topicSource !== undefined) topicSource = opts.topicSource;
  if (opts.activeCustomTopic !== undefined) activeCustomTopic = opts.activeCustomTopic;
}
`
  });

  sandbox.__test_setModuleState({
    wsMode: options.wsMode || 'printable',
    topicSource: options.topicSource || 'catalog',
    activeCustomTopic: options.activeCustomTopic || ''
  });

  await sandbox.generateWorksheet();

  if (capturedPrompt === null) {
    throw new Error('generateWorksheet() never reached the fetch call -- prompt was not captured (a required-field, quota, or custom-topic validation gate returned early)');
  }
  return capturedPrompt;
}

(async () => {

// ---------------------------------------------------------------------
// INTERACTIVE, non-Math (English)
// ---------------------------------------------------------------------
let interactiveNonMath;
await run('INTERACTIVE non-Math: captured a real prompt from generateWorksheet()', async () => {
  interactiveNonMath = await buildPromptViaRealApp({ wsMode: 'interactive', values: { subject: 'English' } });
  assert(typeof interactiveNonMath === 'string' && interactiveNonMath.length > 0, 'expected a non-empty captured prompt');
});

await run('INTERACTIVE non-Math: uses the INTERACTIVE JSON-schema framing', () => {
  assert(interactiveNonMath.includes('Create an INTERACTIVE Multiple Choice Quiz for the following:'), 'expected the INTERACTIVE framing line');
  assert(interactiveNonMath.includes('CRITICAL: Respond with ONLY a valid JSON object'), 'expected the JSON-only instruction');
});

await run('INTERACTIVE non-Math: includes the catalog topic in plain (unquoted) form', () => {
  assert(interactiveNonMath.includes('- Topic: Sample Topic'), 'expected the plain catalog Topic line, got a different format');
  assert(!interactiveNonMath.includes('CUSTOM TOPIC HANDLING'), 'catalog topics must never get the custom-topic policy block');
});

await run('INTERACTIVE non-Math: schema still includes true_false/fill_blank examples (non-Math is unaffected by the Math V1 restriction)', () => {
  assert(interactiveNonMath.includes('"type": "true_false"'), 'expected a true_false example in the non-Math schema');
  assert(interactiveNonMath.includes('"type": "fill_blank"'), 'expected a fill_blank example in the non-Math schema');
});

await run('INTERACTIVE non-Math: no Math-only rules present', () => {
  assert(!interactiveNonMath.includes('GENERAL MATH INTEGRITY RULES'), 'Math integrity rules must not appear for a non-Math subject');
  assert(!interactiveNonMath.includes('CURRENCY RULES'), 'currency rules must not appear for a non-Math subject');
});

await run('INTERACTIVE non-Math: ends with the expected closing instruction, no trailing Math/custom-topic block', () => {
  assert(interactiveNonMath.trim().endsWith('The JSON must always be complete and parseable.'), 'expected the prompt to end with the standard closing instruction, got: ' + interactiveNonMath.slice(-120));
});

// ---------------------------------------------------------------------
// INTERACTIVE, Math
// ---------------------------------------------------------------------
let interactiveMath;
await run('INTERACTIVE Math: captured a real prompt', async () => {
  interactiveMath = await buildPromptViaRealApp({ wsMode: 'interactive', values: { subject: 'Math' } });
});

await run('INTERACTIVE Math: contains the Math-only JSON fields and integrity/currency rules', () => {
  assert(interactiveMath.includes('"solution_steps"'), 'expected solution_steps in the Math schema');
  assert(interactiveMath.includes('"final_answer"'), 'expected final_answer in the Math schema');
  assert(interactiveMath.includes('GENERAL MATH INTEGRITY RULES'), 'expected the Math integrity rules block');
  assert(interactiveMath.includes('CURRENCY RULES'), 'expected the currency rules block');
  assert(interactiveMath.includes('DECIMAL WORD-PROBLEM RULES'), 'expected the decimal word-problem rules block');
});

await run('INTERACTIVE Math: V1 restriction -- schema omits true_false/fill_blank examples and explicitly forbids them', () => {
  assert(!interactiveMath.includes('"type": "true_false"'), 'Math schema must not offer a true_false example');
  assert(!interactiveMath.includes('"type": "fill_blank"'), 'Math schema must not offer a fill_blank example');
  assert(interactiveMath.includes('MUST be type "multiple_choice"'), 'expected the explicit multiple_choice-only instruction');
});

await run('INTERACTIVE Math: no spacing regression -- exactly one blank line before "Output compact JSON"', () => {
  assert(/\n\nOutput compact JSON/.test(interactiveMath), 'expected exactly one blank line (two newlines) immediately before "Output compact JSON"');
  assert(!/\n\n\nOutput compact JSON/.test(interactiveMath), 'found an EXTRA blank line before "Output compact JSON" -- spacing regression');
});

// ---------------------------------------------------------------------
// PRINTABLE, non-Math (English) -- unaffected by any Math/custom-topic work
// ---------------------------------------------------------------------
let printableNonMath;
await run('PRINTABLE non-Math: captured a real prompt', async () => {
  printableNonMath = await buildPromptViaRealApp({ wsMode: 'printable', values: { subject: 'English' } });
});

await run('PRINTABLE non-Math: still asks for clean HTML (unchanged), no Math block', () => {
  assert(printableNonMath.includes('Return your response as clean HTML only'), 'expected the freehand-HTML instruction for non-Math printable');
  assert(!printableNonMath.includes('MATH ANSWER-KEY INTEGRITY'), 'expected no trace of the old (removed) Math printable-HTML hygiene block');
  assert(!printableNonMath.includes('CUSTOM TOPIC HANDLING'), 'catalog topic must not get the custom-topic policy block');
});

// ---------------------------------------------------------------------
// PRINTABLE, Math -- unified into the SAME structured JSON prompt as
// Interactive Math (this was the whole point of the Math reliability fix)
// ---------------------------------------------------------------------
let printableMath;
await run('PRINTABLE Math: captured a real prompt', async () => {
  printableMath = await buildPromptViaRealApp({ wsMode: 'printable', values: { subject: 'Math' } });
});

await run('PRINTABLE Math: never asks the model to freehand HTML (the original bug source)', () => {
  assert(!printableMath.includes('Return your response as clean HTML only'), 'Math must never use the freehand-HTML prompt path, in any mode');
  assert(!printableMath.includes('MATH ANSWER-KEY INTEGRITY'), 'the old freehand-HTML-hygiene block must be fully gone, not just quiet');
});

await run('PRINTABLE Math: requests the identical structured JSON schema and integrity rules as Interactive Math', () => {
  assert(printableMath.includes('"solution_steps"') && printableMath.includes('"final_answer"'), 'expected the same Math JSON schema fields');
  assert(printableMath.includes('GENERAL MATH INTEGRITY RULES'), 'expected the same Math integrity rules');
});

await run('PRINTABLE Math prompt is identical to Interactive Math prompt except for the "INTERACTIVE" framing word', () => {
  assert(printableMath === interactiveMath.replace('Create an INTERACTIVE ', 'Create a '), 'expected the two prompts to differ only in the INTERACTIVE framing word');
});

// ---------------------------------------------------------------------
// CUSTOM TOPIC PROMPT HANDLING
// ---------------------------------------------------------------------
await run('Custom topic: adds the CUSTOM TOPIC HANDLING block; catalog does not', async () => {
  const catalogPrompt = await buildPromptViaRealApp({
    wsMode: 'interactive', topicSource: 'catalog', values: { subject: 'English', topic: 'Sample Topic' }
  });
  assert(!catalogPrompt.includes('CUSTOM TOPIC HANDLING'), 'expected no custom-topic block for a catalog topic');

  const customPrompt = await buildPromptViaRealApp({
    wsMode: 'interactive', topicSource: 'custom', activeCustomTopic: 'Fractions using Filipino recipes',
    values: { subject: 'English' }
  });
  assert(customPrompt.includes('CUSTOM TOPIC HANDLING'), 'expected the custom-topic policy block to be present');
  assert(customPrompt.includes('"Fractions using Filipino recipes" (custom topic provided by the parent/teacher'), 'expected the quoted, labeled custom Topic line');
});

await run('Custom topic: Grade 6 Math + "Differential Equations" includes the foundational-adaptation instruction', async () => {
  const prompt = await buildPromptViaRealApp({
    wsMode: 'printable', topicSource: 'custom', activeCustomTopic: 'Differential Equations',
    values: { grade: 'Grade 6', subject: 'Math', quarter: 'Quarter 1' }
  });
  assert(prompt.includes('Differential Equations'), 'expected the topic present in the prompt');
  assert(/beyond .*level, do not teach the advanced version/.test(prompt), 'expected the foundational-adaptation instruction, got tail: ' + prompt.slice(-600));
  assert(prompt.includes('nearest grade-appropriate foundational concept'), 'expected explicit adaptation guidance, got tail: ' + prompt.slice(-600));
  assert(prompt.includes('GENERAL MATH INTEGRITY RULES'), 'expected Math integrity rules AND custom-topic handling to coexist');
});

await run('Custom topic: never rejects for a quarter mismatch -- explicit "sequence lessons differently" guidance present', async () => {
  const prompt = await buildPromptViaRealApp({
    wsMode: 'interactive', topicSource: 'custom', activeCustomTopic: 'Budgeting for a school project',
    values: { subject: 'Math', quarter: 'Quarter 3' }
  });
  assert(prompt.includes('schools sequence lessons differently'), 'expected explicit quarter-independence guidance');
});

// ---------------------------------------------------------------------
// REV 4: activity-and-mode-aware Math schema (open_response profile)
// ---------------------------------------------------------------------
await run('PRINTABLE Math + Worksheet: requests open_response, NEVER asks for unused choices/answer', async () => {
  const prompt = await buildPromptViaRealApp({ wsMode: 'printable', values: { subject: 'Math', activity: 'Worksheet' } });
  assert(prompt.includes('"type": "open_response"'), 'expected the open_response schema example');
  // Checked as a field KEY (quote-colon), not a bare substring -- the
  // integrity rules deliberately mention the word "choices" in prose
  // ("Do NOT include a \"choices\" field...") to instruct the model NOT to
  // send it, which would otherwise false-positive a naive substring check.
  assert(!prompt.includes('"choices":'), 'expected NO choices field requested for a Printable Worksheet Math activity');
  assert(!prompt.includes('"answer":'), 'expected NO answer field requested for a Printable Worksheet Math activity');
  assert(prompt.includes('"solution_steps"') && prompt.includes('"final_answer"'), 'expected solution_steps/final_answer still requested');
});

await run('PRINTABLE Math + Multiple Choice Quiz: still requests choices/answer (unchanged)', async () => {
  const prompt = await buildPromptViaRealApp({ wsMode: 'printable', values: { subject: 'Math', activity: 'Multiple Choice Quiz' } });
  assert(prompt.includes('"type": "multiple_choice"'), 'expected the multiple_choice schema example');
  assert(prompt.includes('"choices"') && prompt.includes('"answer"'), 'expected choices/answer still requested for Multiple Choice Quiz');
});

await run('PRINTABLE Math + Reading Comprehension: open_response schema requests structured story_facts/evidence_fact_ids, NEVER passage/passage_evidence', async () => {
  const prompt = await buildPromptViaRealApp({ wsMode: 'printable', values: { subject: 'Math', activity: 'Reading Comprehension' } });
  assert(prompt.includes('"type": "open_response"'), 'expected the open_response schema example');
  assert(!prompt.includes('"choices":'), 'expected no choices field for Reading Comprehension');
  assert(prompt.includes('"story_facts":'), 'expected story_facts requested for Reading Comprehension');
  assert(prompt.includes('"evidence_fact_ids":'), 'expected evidence_fact_ids requested per question');
  assert(!prompt.includes('"passage":'), 'Math Reading Comprehension must never request the old freehand passage field');
  assert(!prompt.includes('"passage_evidence":'), 'Math Reading Comprehension must never request the old passage_evidence field');
  assert(/story_facts.*array where every entry has a unique string "id"/.test(prompt), 'expected the story_facts structural integrity rule text');
  assert(/evidence_fact_ids.*array listing the story_facts id/.test(prompt), 'expected the evidence_fact_ids integrity rule text');
});

await run('PRINTABLE Math + Matching Type: open_response schema, integrity rules require a bare value and a pre-planned distinct set', async () => {
  const prompt = await buildPromptViaRealApp({ wsMode: 'printable', values: { subject: 'Math', activity: 'Matching Type' } });
  assert(prompt.includes('"type": "open_response"'), 'expected the open_response schema example');
  assert(!prompt.includes('"passage_evidence":') && !prompt.includes('"story_facts":'), 'Matching Type must not request Reading-Comprehension-only fields');
  assert(/mathematically equivalent/.test(prompt), 'expected the Matching Type final-answer-uniqueness rule text');
  assert(/BARE mathematical value/.test(prompt), 'expected the bare-value-only rule text');
  assert(/PLAN a set of \d+ distinct answer values/.test(prompt), 'expected the explicit plan-distinct-values-first instruction');
});

await run('INTERACTIVE non-Math Reading Comprehension: still requests the original "passage" JSON field, completely unaffected by the Math story_facts change', async () => {
  const prompt = await buildPromptViaRealApp({ wsMode: 'interactive', values: { subject: 'English', activity: 'Reading Comprehension' } });
  assert(prompt.includes('"passage":'), 'expected the original freehand passage field for non-Math Reading Comprehension');
  assert(!prompt.includes('"story_facts":'), 'non-Math Reading Comprehension must never request story_facts');
});

await run('PRINTABLE Math + Parent/Tutor Support Sheet: open_response schema, no coaching field requested from the model', async () => {
  const prompt = await buildPromptViaRealApp({ wsMode: 'printable', values: { subject: 'Math', activity: 'Parent/Tutor Support Sheet' } });
  assert(prompt.includes('"type": "open_response"'), 'expected the open_response schema example');
  assert(!prompt.includes('"choices":'), 'expected no choices field for Parent/Tutor Support Sheet');
  assert(!prompt.includes('parent_tutor_guide') && !prompt.includes('"guide"'), 'the Parent/Tutor Guide must be renderer-owned -- no such field should ever be requested from the model');
});

await run('INTERACTIVE Math + Reading Comprehension activity string: STILL requests multiple_choice (mode gates the profile, not activity alone)', async () => {
  const prompt = await buildPromptViaRealApp({ wsMode: 'interactive', values: { subject: 'Math', activity: 'Reading Comprehension' } });
  assert(prompt.includes('"type": "multiple_choice"'), 'Interactive Math must always request multiple_choice regardless of the activity string');
  assert(prompt.includes('"choices"') && prompt.includes('"answer"'), 'expected choices/answer still requested for Interactive Math');
});

await run('INTERACTIVE Math + Matching Type activity string: STILL requests multiple_choice, no uniqueness rule text', async () => {
  const prompt = await buildPromptViaRealApp({ wsMode: 'interactive', values: { subject: 'Math', activity: 'Matching Type' } });
  assert(prompt.includes('"type": "multiple_choice"'), 'Interactive Math must always request multiple_choice regardless of the activity string');
  assert(!/mathematically equivalent/.test(prompt), 'Interactive Math must not get the Printable Matching Type uniqueness rule');
});

console.log('\nDone.');
})();

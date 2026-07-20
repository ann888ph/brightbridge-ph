// Mocked-fetch integration test for netlify/functions/generate.js.
// No live Supabase/Anthropic access is used or required -- every network
// call is intercepted and scripted. This verifies the CONTROL FLOW (call
// order, response shapes, error handling) since the actual RPC atomicity
// can only be verified against a real Postgres instance.

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';

const path = require('path');
const handlerPath = path.join(__dirname, '..', 'netlify', 'functions', 'generate.js');
const { run, assert } = require('./helpers/run.js');

// Builds a scripted fetch mock. `script` is an array of matcher functions;
// each incoming fetch(url, opts) is matched against the script in order,
// consumed once matched. Throws if a call doesn't match anything expected,
// or if calls remain unconsumed at the end (checked by the caller).
function makeMockFetch(script) {
  const calls = [];
  const remaining = script.slice();
  return {
    calls,
    fetchFn: async (url, opts) => {
      calls.push({ url, opts });
      if (remaining.length === 0) {
        throw new Error('Unexpected extra fetch call to: ' + url);
      }
      const matcher = remaining.shift();
      return matcher(url, opts);
    },
    assertExhausted: () => {
      if (remaining.length !== 0) {
        throw new Error('Expected ' + remaining.length + ' more fetch call(s) that never happened');
      }
    }
  };
}

function jsonResponse(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers && headers[k]) || null },
    json: async () => body
  };
}

function baseEvent(overrides) {
  return Object.assign({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer faketoken' },
    body: JSON.stringify(Object.assign({
      prompt: 'a prompt', subject: 'English', mode: 'printable',
      grade: 'Grade 4', quarter: 'Quarter 1', topic: 'Topic', topicSource: 'catalog', difficulty: 'Standard', activity: 'Worksheet',
      items: '10', supportFlags: {}
    }, overrides && overrides.bodyOverrides))
  }, overrides && overrides.eventOverrides);
}

async function invoke(mockFetch, eventOverrides) {
  delete require.cache[require.resolve(handlerPath)];
  global.fetch = mockFetch.fetchFn;
  const { handler } = require(handlerPath);
  const res = await handler(baseEvent(eventOverrides));
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const AUTH_OK = () => jsonResponse(200, { id: 'user-1', email: 'a@b.com' });
const PROFILE_OK = () => jsonResponse(200, [{ plan: 'free', cycle_start: new Date().toISOString() }]);

// items must be one of [5,10,15,20] to pass generate.js's own allowlist gate;
// build a matching-length quiz so validateMathQuestions' exact-count check
// also passes (or deliberately fails, via makeWrongAnswerQuiz).
function makeValidQuiz(count) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push({ type: 'multiple_choice', question: (i + 2) + '+2?', solution_steps: (i + 2) + '+2=' + (i + 4), final_answer: String(i + 4), choices: [String(i + 3), String(i + 4), String(i + 5), String(i + 6)], answer: 1 });
  }
  return JSON.stringify({ title: 't', directions: 'd', questions });
}
function makeWrongAnswerQuiz(count) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push({ type: 'multiple_choice', question: (i + 2) + '+2?', solution_steps: (i + 2) + '+2=' + (i + 4), final_answer: String(i + 100), choices: [String(i + 3), String(i + 4), String(i + 5), String(i + 6)], answer: 1 }); // final_answer never matches any choice
  }
  return JSON.stringify({ title: 't', directions: 'd', questions });
}

// REV 4 helpers: open_response-shaped Math (Printable non-MCQ activities).
function makeValidOpenResponseQuiz(count) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push({ type: 'open_response', question: (i + 2) + '+2?', solution_steps: (i + 2) + '+2=' + (i + 4), final_answer: String(i + 4) });
  }
  return JSON.stringify({ title: 't', directions: 'd', questions });
}

const RESERVE_OK_LOCAL = (id) => () => jsonResponse(200, [{ reserved: true, reservation_id: id || 'res-local', reason: null }]);
const ANTHROPIC_OK_LOCAL = (text) => () => jsonResponse(200, { content: [{ type: 'text', text: text || '<h1>Worksheet</h1>' }], usage: { input_tokens: 10, output_tokens: 20 } });
const FINALIZE_OK_LOCAL = () => jsonResponse(200, [{ finalized: true, reason: null }]);

(async () => {

  await run('missing Authorization header -> 401, no Supabase/Anthropic calls', async () => {
    const mock = makeMockFetch([]);
    const { status, body } = await invoke(mock, { eventOverrides: { headers: {} } });
    assert(status === 401, 'expected 401, got ' + status);
    assert(mock.calls.length === 0, 'expected zero fetch calls, got ' + mock.calls.length);
  });

  await run('invalid items ("999") -> 400 BEFORE any Supabase/Anthropic call beyond auth', async () => {
    const mock = makeMockFetch([AUTH_OK]);
    const { status, body } = await invoke(mock, { bodyOverrides: { items: '999' } });
    assert(status === 400, 'expected 400, got ' + status + ' body=' + JSON.stringify(body));
    mock.assertExhausted();
  });

  await run('non-Math subject: one Anthropic call, one finalize, 200 with result', async () => {
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-1', reason: null }]), // reserve_usage_slot
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: '<h1>Worksheet</h1>' }], usage: { input_tokens: 100, output_tokens: 200 } }), // Anthropic
      () => jsonResponse(200, [{ finalized: true, reason: null }]) // finalize_validated_generation
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'English', mode: 'printable' } });
    assert(status === 200, 'expected 200, got ' + status + ' body=' + JSON.stringify(body));
    assert(body.result === '<h1>Worksheet</h1>', 'unexpected result content: ' + body.result);
    mock.assertExhausted();
  });

  await run('quota exceeded reservation refusal -> 429, ZERO Anthropic calls', async () => {
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: false, reservation_id: null, reason: 'quota_exceeded' }])
    ]);
    const { status, body } = await invoke(mock);
    assert(status === 429, 'expected 429, got ' + status);
    assert(/monthly worksheet limit/.test(body.error), 'expected quota message, got: ' + body.error);
    mock.assertExhausted(); // proves no Anthropic call happened
  });

  await run('provider-attempt-limit reservation refusal -> 429 with distinct message, ZERO Anthropic calls', async () => {
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: false, reservation_id: null, reason: 'provider_attempt_limit_exceeded' }])
    ]);
    const { status, body } = await invoke(mock);
    assert(status === 429, 'expected 429, got ' + status);
    assert(/too many generation attempts/i.test(body.error), 'expected attempt-limit message, got: ' + body.error);
    mock.assertExhausted();
  });

  await run('Math interactive: first attempt validates OK -> single Anthropic call, finalize, 200', async () => {
    const goodQuizJson = makeValidQuiz(5);
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-2', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: goodQuizJson }], usage: { input_tokens: 50, output_tokens: 60 } }),
      () => jsonResponse(200, [{ finalized: true, reason: null }])
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', items: '5' } });
    assert(status === 200, 'expected 200, got ' + status + ' body=' + JSON.stringify(body));
    assert(body.result === goodQuizJson, 'expected the valid quiz JSON returned as-is');
    mock.assertExhausted();
  });

  await run('Math interactive: attempt 1 fails validation, retry succeeds -> 2 Anthropic calls, retry RPC called, finalize, 200', async () => {
    const badQuizJson = makeWrongAnswerQuiz(5);
    const goodQuizJson = makeValidQuiz(5);
    let retryRpcCalled = false;
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-3', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: badQuizJson }], usage: { input_tokens: 10, output_tokens: 20 } }), // attempt 1: bad
      (url) => { retryRpcCalled = true; assert(/reserve_provider_retry/.test(url), 'expected reserve_provider_retry call'); return jsonResponse(200, [{ allowed: true, reason: null }]); },
      () => jsonResponse(200, { content: [{ type: 'text', text: goodQuizJson }], usage: { input_tokens: 15, output_tokens: 25 } }), // attempt 2: good
      (url, opts) => {
        const parsed = JSON.parse(opts.body);
        assert(parsed.p_input_tokens === 25, 'expected summed input tokens 10+15=25, got ' + parsed.p_input_tokens);
        assert(parsed.p_output_tokens === 45, 'expected summed output tokens 20+25=45, got ' + parsed.p_output_tokens);
        return jsonResponse(200, [{ finalized: true, reason: null }]);
      }
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', items: '5' } });
    assert(status === 200, 'expected 200, got ' + status + ' body=' + JSON.stringify(body));
    assert(retryRpcCalled, 'expected reserve_provider_retry to have been called');
    assert(body.result === goodQuizJson, 'expected the SECOND (valid) attempt returned, not the first');
    mock.assertExhausted();
  });

  await run('Math interactive: both attempts fail validation -> 2 Anthropic calls, finalizeFailed PATCH, 502, no result delivered', async () => {
    const badQuizJson = makeWrongAnswerQuiz(5);
    let finalizeFailedPatchCalled = false;
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-4', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: badQuizJson }], usage: { input_tokens: 10, output_tokens: 20 } }),
      () => jsonResponse(200, [{ allowed: true, reason: null }]), // retry allowed
      () => jsonResponse(200, { content: [{ type: 'text', text: badQuizJson }], usage: { input_tokens: 11, output_tokens: 21 } }), // still bad
      (url, opts) => {
        assert(opts.method === 'PATCH', 'expected a PATCH to usage_logs for the failure path');
        assert(/usage_logs\?id=eq\.res-4&user_id=eq\.user-1/.test(url), 'expected id+user_id scoped PATCH url, got: ' + url);
        const parsed = JSON.parse(opts.body);
        assert(parsed.is_chargeable === false, 'expected is_chargeable:false on final failure');
        finalizeFailedPatchCalled = true;
        return jsonResponse(200, {});
      }
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', items: '5' } });
    assert(status === 502, 'expected 502, got ' + status);
    assert(!body.result, 'must never deliver a result on final validation failure');
    assert(finalizeFailedPatchCalled, 'expected the failure PATCH to have been made');
    mock.assertExhausted();
  });

  await run('Math interactive: retry refused by budget -> only 1 Anthropic call total, 502, no result', async () => {
    const badQuizJson = makeWrongAnswerQuiz(5);
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-5', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: badQuizJson }], usage: { input_tokens: 10, output_tokens: 20 } }),
      () => jsonResponse(200, [{ allowed: false, reason: 'provider_attempt_limit_exceeded' }]), // retry REFUSED
      () => jsonResponse(200, {}) // finalizeFailed PATCH
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', items: '5' } });
    assert(status === 502, 'expected 502, got ' + status);
    assert(!body.result, 'must never deliver a result');
    mock.assertExhausted(); // proves the 2nd Anthropic call never happened
  });

  await run('finalize_validated_generation returns finalized:false (expired) -> 503, result discarded even though generation succeeded', async () => {
    const goodQuizJson = makeValidQuiz(5);
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-6', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: goodQuizJson }], usage: { input_tokens: 5, output_tokens: 5 } }),
      () => jsonResponse(200, [{ finalized: false, reason: 'reservation_expired' }])
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', items: '5' } });
    assert(status === 503, 'expected 503, got ' + status);
    assert(!body.result, 'must discard the result when finalization reports expired, even though the content was valid');
    mock.assertExhausted();
  });

  await run('Anthropic API error on first call -> finalizeFailed(provider_error), 502, no retry attempted', async () => {
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-7', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(500, { error: { message: 'Anthropic is down' } }),
      (url, opts) => {
        const parsed = JSON.parse(opts.body);
        assert(parsed.validation_status === 'provider_error', 'expected provider_error status');
        return jsonResponse(200, {});
      }
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', items: '5' } });
    assert(status === 502, 'expected 502, got ' + status);
    assert(/Anthropic is down/.test(body.error), 'expected the Anthropic error message passed through');
    mock.assertExhausted(); // proves no retry RPC was ever called for a raw provider error
  });

  await run('REGRESSION: reserve_usage_slot RPC call includes p_email with the authenticated user\'s email', async () => {
    const goodQuizJson = makeValidQuiz(5);
    let capturedReserveBody = null;
    const mock = makeMockFetch([
      () => jsonResponse(200, { id: 'user-1', email: 'ann888ph@gmail.com' }), // AUTH_OK with a specific email
      PROFILE_OK,
      (url, opts) => {
        assert(/reserve_usage_slot/.test(url), 'expected the reserve_usage_slot call');
        capturedReserveBody = JSON.parse(opts.body);
        return jsonResponse(200, [{ reserved: true, reservation_id: 'res-8', reason: null }]);
      },
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: goodQuizJson }], usage: { input_tokens: 5, output_tokens: 5 } }),
      () => jsonResponse(200, [{ finalized: true, reason: null }])
    ]);
    const { status } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', items: '5' } });
    assert(status === 200, 'expected 200, got ' + status);
    assert(capturedReserveBody !== null, 'expected reserve_usage_slot to have been called');
    assert(capturedReserveBody.p_email === 'ann888ph@gmail.com', 'expected p_email to carry the authenticated user\'s email, got: ' + JSON.stringify(capturedReserveBody.p_email));
    mock.assertExhausted();
  });

  await run('STRUCTURED MATH: Printable Math is now VALIDATED (not blocked) -- first attempt OK -> single Anthropic call, finalize, 200', async () => {
    const goodQuizJson = makeValidQuiz(10);
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-11', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: goodQuizJson }], usage: { input_tokens: 50, output_tokens: 60 } }),
      () => jsonResponse(200, [{ finalized: true, reason: null }])
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'printable', activity: 'Multiple Choice Quiz', items: '10' } });
    assert(status === 200, 'expected 200, got ' + status + ' body=' + JSON.stringify(body));
    assert(body.result === goodQuizJson, 'expected the valid quiz JSON returned as-is for printable Math too');
    mock.assertExhausted();
  });

  await run('STRUCTURED MATH: Printable Math attempt 1 fails validation, retry succeeds -> 2 Anthropic calls, retry RPC called, finalize, 200', async () => {
    const badQuizJson = makeWrongAnswerQuiz(10);
    const goodQuizJson = makeValidQuiz(10);
    let retryRpcCalled = false;
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-12', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: badQuizJson }], usage: { input_tokens: 10, output_tokens: 20 } }),
      (url) => { retryRpcCalled = true; assert(/reserve_provider_retry/.test(url), 'expected reserve_provider_retry call'); return jsonResponse(200, [{ allowed: true, reason: null }]); },
      () => jsonResponse(200, { content: [{ type: 'text', text: goodQuizJson }], usage: { input_tokens: 15, output_tokens: 25 } }),
      () => jsonResponse(200, [{ finalized: true, reason: null }])
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'printable', activity: 'Multiple Choice Quiz', items: '10' } });
    assert(status === 200, 'expected 200, got ' + status + ' body=' + JSON.stringify(body));
    assert(retryRpcCalled, 'expected reserve_provider_retry to have been called for printable Math, same as interactive');
    assert(body.result === goodQuizJson, 'expected the SECOND (valid) attempt returned');
    mock.assertExhausted();
  });

  await run('STRUCTURED MATH: Printable Math both attempts fail validation -> 502, no result delivered (validation is NOT skipped for printable)', async () => {
    const badQuizJson = makeWrongAnswerQuiz(10);
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-13', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: badQuizJson }], usage: { input_tokens: 10, output_tokens: 20 } }),
      () => jsonResponse(200, [{ allowed: true, reason: null }]),
      () => jsonResponse(200, { content: [{ type: 'text', text: badQuizJson }], usage: { input_tokens: 11, output_tokens: 21 } }),
      () => jsonResponse(200, {}) // finalizeFailed PATCH
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'printable', activity: 'Multiple Choice Quiz', items: '10' } });
    assert(status === 502, 'expected 502, got ' + status);
    assert(!body.result, 'must never deliver a result on final validation failure, printable or not');
    mock.assertExhausted();
  });

  await run('Math + Interactive still works identically after widening the gate to isMathStructured', async () => {
    const goodQuizJson = makeValidQuiz(5);
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-9', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: goodQuizJson }], usage: { input_tokens: 5, output_tokens: 5 } }),
      () => jsonResponse(200, [{ finalized: true, reason: null }])
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', items: '5' } });
    assert(status === 200, 'expected 200, got ' + status + ' body=' + JSON.stringify(body));
    assert(body.result === goodQuizJson, 'expected the normal Math interactive flow to proceed unblocked');
    mock.assertExhausted();
  });

  await run('Printable non-Math (English) is completely unaffected by the Math JSON-unification', async () => {
    const mock = makeMockFetch([
      AUTH_OK,
      PROFILE_OK,
      () => jsonResponse(200, [{ reserved: true, reservation_id: 'res-10', reason: null }]),
      () => jsonResponse(200, {}), // topic_source/quarter tagging PATCH
      () => jsonResponse(200, { content: [{ type: 'text', text: '<h1>English Worksheet</h1>' }], usage: { input_tokens: 100, output_tokens: 200 } }),
      () => jsonResponse(200, [{ finalized: true, reason: null }])
    ]);
    const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'English', mode: 'printable', items: '10' } });
    assert(status === 200, 'expected 200, got ' + status + ' body=' + JSON.stringify(body));
    assert(body.result === '<h1>English Worksheet</h1>', 'expected the normal printable non-Math flow to proceed unblocked');
    mock.assertExhausted();
  });

  // =====================================================================
  // REV 4: mode allowlist -- server-validated, exact-match, no default
  // =====================================================================
  await run('MODE: missing mode -> 400 BEFORE any Supabase/Anthropic call beyond auth', async () => {
    const mock = makeMockFetch([AUTH_OK]);
    const event = baseEvent();
    const parsedBody = JSON.parse(event.body);
    delete parsedBody.mode;
    event.body = JSON.stringify(parsedBody);
    delete require.cache[require.resolve(handlerPath)];
    global.fetch = mock.fetchFn;
    const { handler } = require(handlerPath);
    const res = await handler(event);
    assert(res.statusCode === 400, 'expected 400, got ' + res.statusCode);
    mock.assertExhausted();
  });

  await run('MODE: unknown/mis-cased/whitespace-padded values are all rejected -- never trimmed or case-folded', async () => {
    for (const badMode of ['Printable', 'INTERACTIVE', ' printable', 'printable ', 'pdf', '']) {
      const mock = makeMockFetch([AUTH_OK]);
      const { status } = await invoke(mock, { bodyOverrides: { mode: badMode } });
      assert(status === 400, `expected 400 for mode=${JSON.stringify(badMode)}, got ${status}`);
      mock.assertExhausted();
    }
  });

  await run('MODE: valid "interactive" and valid "printable" both pass this gate', async () => {
    for (const goodMode of ['interactive', 'printable']) {
      const mock = makeMockFetch([AUTH_OK, PROFILE_OK, RESERVE_OK_LOCAL(), () => jsonResponse(200, {}), ANTHROPIC_OK_LOCAL(), FINALIZE_OK_LOCAL]);
      const { status } = await invoke(mock, { bodyOverrides: { subject: 'English', mode: goodMode } });
      assert(status === 200, `expected 200 for mode=${goodMode}, got ${status}`);
    }
  });

  // =====================================================================
  // REV 4: activity allowlist + Fill in the Blanks for Math
  // =====================================================================
  await run('ACTIVITY: missing activity -> 400 BEFORE any Supabase/Anthropic call beyond auth', async () => {
    const mock = makeMockFetch([AUTH_OK]);
    const event = baseEvent();
    const parsedBody = JSON.parse(event.body);
    delete parsedBody.activity;
    event.body = JSON.stringify(parsedBody);
    delete require.cache[require.resolve(handlerPath)];
    global.fetch = mock.fetchFn;
    const { handler } = require(handlerPath);
    const res = await handler(event);
    assert(res.statusCode === 400, 'expected 400, got ' + res.statusCode);
    mock.assertExhausted();
  });

  await run('ACTIVITY: unknown activity string -> 400 BEFORE any Supabase/Anthropic call beyond auth', async () => {
    const mock = makeMockFetch([AUTH_OK]);
    const { status } = await invoke(mock, { bodyOverrides: { activity: 'Essay Writing' } });
    assert(status === 400, 'expected 400, got ' + status);
    mock.assertExhausted();
  });

  // =====================================================================
  // PRODUCT DECISION: hide/reject unstable Math activity types
  // (Reading Comprehension, Matching Type, Fill in the Blanks). This is an
  // AVAILABILITY decision only -- the underlying validator/renderer/schema
  // for all three (see math-validation.js, app.js) are left fully intact
  // and remain directly covered by test_math_validation.js/
  // test_printable_math_render.js; only the public Math+activity
  // combination is refused here, before quota reservation, usage logging,
  // or any Anthropic call. Non-Math subjects are completely unaffected.
  // =====================================================================
  const MATH_UNAVAILABLE_ACTIVITIES_FOR_TEST = ['Reading Comprehension', 'Matching Type', 'Fill in the Blanks'];
  const MATH_AVAILABLE_ACTIVITIES_FOR_TEST = ['Worksheet', 'Multiple Choice Quiz', 'Parent/Tutor Support Sheet'];

  for (const activity of MATH_UNAVAILABLE_ACTIVITIES_FOR_TEST) {
    await run(`MATH CONTAINMENT: Math + "${activity}" (printable) is rejected with 400 before any reservation/Anthropic call, zero cost`, async () => {
      const mock = makeMockFetch([AUTH_OK]);
      const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'printable', activity, items: '5' } });
      assert(status === 400, 'expected 400, got ' + status);
      assert(/currently unavailable for Math/.test(body.error || ''), 'expected the friendly unavailable-for-Math message, got: ' + JSON.stringify(body));
      mock.assertExhausted();
    });

    await run(`MATH CONTAINMENT: Math + "${activity}" (interactive) is ALSO rejected with 400 -- the block is mode-independent`, async () => {
      const mock = makeMockFetch([AUTH_OK]);
      const { status } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'interactive', activity, items: '5' } });
      assert(status === 400, 'expected 400, got ' + status);
      mock.assertExhausted();
    });

    await run(`MATH CONTAINMENT: Math + "${activity}" is allowed for a non-Math subject (English) -- the rejection is Math-specific, not global`, async () => {
      const mock = makeMockFetch([AUTH_OK, PROFILE_OK, RESERVE_OK_LOCAL(), () => jsonResponse(200, {}), ANTHROPIC_OK_LOCAL(), FINALIZE_OK_LOCAL]);
      const { status } = await invoke(mock, { bodyOverrides: { subject: 'English', activity } });
      assert(status === 200, 'expected 200 for English + "' + activity + '", got ' + status);
    });
  }

  for (const activity of MATH_AVAILABLE_ACTIVITIES_FOR_TEST) {
    await run(`MATH CONTAINMENT: Math + "${activity}" remains fully available (unaffected by the containment decision)`, async () => {
      const goodQuizJson = activity === 'Multiple Choice Quiz' ? makeValidQuiz(5) : makeValidOpenResponseQuiz(5);
      const mock = makeMockFetch([AUTH_OK, PROFILE_OK, RESERVE_OK_LOCAL(), () => jsonResponse(200, {}), ANTHROPIC_OK_LOCAL(goodQuizJson), FINALIZE_OK_LOCAL]);
      const { status, body } = await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'printable', activity, items: '5' } });
      assert(status === 200, 'expected 200 for Math + "' + activity + '", got ' + status + ' body=' + JSON.stringify(body));
    });
  }

  // =====================================================================
  // REV 4: non-Math regression -- all 6 activity values still accepted
  // =====================================================================
  await run('NON-MATH REGRESSION: all 6 ALLOWED_ACTIVITIES values are accepted for a non-Math (English) request', async () => {
    const activities = ['Worksheet', 'Multiple Choice Quiz', 'Reading Comprehension', 'Matching Type', 'Fill in the Blanks', 'Parent/Tutor Support Sheet'];
    for (const activity of activities) {
      const mock = makeMockFetch([AUTH_OK, PROFILE_OK, RESERVE_OK_LOCAL(), () => jsonResponse(200, {}), ANTHROPIC_OK_LOCAL(), FINALIZE_OK_LOCAL]);
      const { status } = await invoke(mock, { bodyOverrides: { subject: 'English', activity } });
      assert(status === 200, `expected 200 for non-Math activity=${activity}, got ${status}`);
    }
  });

  await run('NON-MATH REGRESSION: the server-owned Math activity policy text is ABSENT from a non-Math effective prompt', async () => {
    const captured = {};
    const mock = makeMockFetch([
      AUTH_OK, PROFILE_OK, RESERVE_OK_LOCAL(),
      () => jsonResponse(200, {}),
      (url, opts) => { captured.content = JSON.parse(opts.body).messages[0].content; return jsonResponse(200, { content: [{ type: 'text', text: '<h1>W</h1>' }], usage: { input_tokens: 1, output_tokens: 1 } }); },
      FINALIZE_OK_LOCAL
    ]);
    await invoke(mock, { bodyOverrides: { subject: 'English', activity: 'Matching Type' } });
    assert(!captured.content.includes('SERVER-ENFORCED MATH ACTIVITY SCHEMA POLICY'), 'expected no Math activity policy text for a non-Math request');
  });

  // =====================================================================
  // REV 4: server-owned Math activity schema policy content
  // =====================================================================
  function capturePromptMatcher(captured, text) {
    return (url, opts) => {
      captured.content = JSON.parse(opts.body).messages[0].content;
      return jsonResponse(200, { content: [{ type: 'text', text: text }], usage: { input_tokens: 1, output_tokens: 1 } });
    };
  }

  await run('POLICY: Printable Worksheet (Math) gets the open_response schema restatement, cannot be stripped by the client prompt', async () => {
    const captured = {};
    const mock = makeMockFetch([AUTH_OK, PROFILE_OK, RESERVE_OK_LOCAL(), () => jsonResponse(200, {}), capturePromptMatcher(captured, makeValidOpenResponseQuiz(5)), FINALIZE_OK_LOCAL]);
    await invoke(mock, { bodyOverrides: { prompt: 'a bare client prompt with no schema instructions at all', subject: 'Math', mode: 'printable', activity: 'Worksheet', items: '5' } });
    assert(captured.content.includes('SERVER-ENFORCED MATH ACTIVITY SCHEMA POLICY'), 'expected the server-owned Math activity policy to be present');
    assert(captured.content.includes('open_response'), 'expected the open_response schema restatement');
  });

  await run('POLICY: Printable Multiple Choice Quiz (Math) does NOT get the open_response policy block', async () => {
    const captured = {};
    const mock = makeMockFetch([AUTH_OK, PROFILE_OK, RESERVE_OK_LOCAL(), () => jsonResponse(200, {}), capturePromptMatcher(captured, makeValidQuiz(5)), FINALIZE_OK_LOCAL]);
    await invoke(mock, { bodyOverrides: { subject: 'Math', mode: 'printable', activity: 'Multiple Choice Quiz', items: '5' } });
    assert(!captured.content.includes('SERVER-ENFORCED MATH ACTIVITY SCHEMA POLICY'), 'expected no open_response policy block for Multiple Choice Quiz');
  });

  // NOTE: the previous PRODUCTION FIX task added integration-level tests
  // here for Reading Comprehension (story_facts)/Matching Type retry
  // behavior, sanitized diagnostics, and repair-block security via
  // generate.js's handler. The PRODUCT DECISION above now rejects Math +
  // Reading Comprehension and Math + Matching Type before any of that
  // logic is ever reached (see the MATH CONTAINMENT tests), so those
  // handler-level tests were removed as no longer reachable through the
  // public API. Nothing was deleted from production code: validateMathQuestions()
  // itself (story_facts/evidence_fact_ids structure, Matching Type bare-value/
  // uniqueness rules) remains fully exercised directly in
  // test_math_validation.js, and the renderer in test_printable_math_render.js.
  // generate.js's own classifyValidationReason()/buildRepairBlock()/
  // logMathValidationFailure() helpers are unreachable for these two
  // activities until this containment decision is revisited.

  console.log('\nDone.');
})();

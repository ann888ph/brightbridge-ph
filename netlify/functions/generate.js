// netlify/functions/generate.js
// BrightBridge PH - worksheet generation with SERVER-SIDE quota enforcement,
// an independent provider-attempt safety ceiling, and server-authoritative
// Math validation (Math subject, both interactive and printable mode --
// app.js always requests the same structured JSON for Math regardless of
// mode, so this file validates it identically either way). Quota and
// attempt accounting go through atomic Postgres RPCs (see the accompanying
// migration) so concurrent requests can never double-book the same quota
// slot or silently exceed the attempt ceiling.
//
// Required Netlify environment variables:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL               - https://jyoczjbiskgxuupdcnff.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  - from Supabase Dashboard > Settings > API > service_role
//                                (NEVER put this in index.html - server-side only!)
//
// The reservation/finalization RPCs (reserve_usage_slot, reserve_provider_
// retry, finalize_validated_generation) are locked down at the database
// level to service_role only (see migration) -- this function is the sole
// legitimate caller.

const { parseQuizJson, validateMathQuestions } = require("../../math-validation.js");

const PLAN_LIMITS = {
  free: 5,
  parent: 20,
  family_plus: 60,
  teacher: 150
};

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_MAX_TOKENS = 8000;

// Matches the <select id="items"> options in index.html exactly.
const ALLOWED_ITEM_COUNTS = [5, 10, 15, 20];

// Independent of the quota limit above: bounds the WORST CASE of real
// Anthropic spend a single user can trigger per rolling day, regardless of
// how many of those calls end up chargeable. Generous relative to even the
// highest plan's typical daily use, but never unbounded.
const MAX_PROVIDER_ATTEMPTS_PER_DAY = 40;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid request body" });
  }

  const { prompt, subject, mode, grade, topic, difficulty, activity, items, supportFlags } = body;
  if (!prompt) {
    return json(400, { error: "Missing prompt" });
  }

  // ---------- 1. AUTHENTICATE: verify the Supabase access token ----------
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return json(401, { error: "Please log in to generate worksheets." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!userRes.ok) {
    return json(401, { error: "Your session has expired. Please log in again." });
  }
  const user = await userRes.json();
  const userId = user.id;
  const userEmail = user.email;

  // ---------- 2. VALIDATE items BEFORE any provider call ----------
  // Treat every client-supplied field as untrusted (see the prompt-
  // construction design note at the bottom of this file) -- this is the
  // cheapest, earliest check: reject before touching Supabase or Anthropic.
  const parsedItemCount = Number.parseInt(items, 10);
  if (!ALLOWED_ITEM_COUNTS.includes(parsedItemCount)) {
    return json(400, { error: "Invalid item count." });
  }

  // ---------- 3. LOAD PLAN + CYCLE START (service role bypasses RLS) ----------
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=plan,cycle_start`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const profiles = profileRes.ok ? await profileRes.json() : [];
  const plan = (profiles[0] && profiles[0].plan) || "free";
  const cycleStart = profiles[0] && profiles[0].cycle_start;
  const quotaLimit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  let quotaSince;
  if (cycleStart) {
    quotaSince = new Date(cycleStart);
  } else {
    quotaSince = new Date();
    quotaSince.setDate(1);
    quotaSince.setHours(0, 0, 0, 0);
  }
  const attemptSince = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // ---------- 4. RESERVE: atomic quota slot + first provider-attempt slot ----------
  async function callRpc(name, params) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const rows = await res.json();
    return { ok: true, row: Array.isArray(rows) ? rows[0] : rows };
  }

  const reserveResult = await callRpc("reserve_usage_slot", {
    p_user_id: userId,
    p_quota_since: quotaSince.toISOString(),
    p_quota_limit: quotaLimit,
    p_attempt_since: attemptSince.toISOString(),
    p_attempt_limit: MAX_PROVIDER_ATTEMPTS_PER_DAY,
    p_subject: subject || null,
    p_mode: mode || null,
    p_grade: grade || null,
    p_topic: topic || null,
    p_difficulty: difficulty || null,
    p_activity_type: activity || null,
    p_dysgraphia: !!(supportFlags && supportFlags.dysgraphia),
    p_simplified: !!(supportFlags && supportFlags.simplified),
    p_attention: !!(supportFlags && supportFlags.attention),
    p_processing: !!(supportFlags && supportFlags.processing),
    p_email: userEmail || null
  });

  if (!reserveResult.ok) {
    console.error("reserve_usage_slot call failed:", reserveResult.status);
    return json(503, { error: "We could not verify your worksheet allowance. Please try again shortly." });
  }
  if (!reserveResult.row || !reserveResult.row.reserved) {
    const reason = reserveResult.row && reserveResult.row.reason;
    if (reason === "provider_attempt_limit_exceeded") {
      return json(429, { error: "Too many generation attempts recently. Please try again later." });
    }
    const SEEDLING = String.fromCharCode(0xD83C, 0xDF31); // kept ASCII-only in source, see math-validation.js convention
    return json(429, {
      error: "You've reached your monthly worksheet limit. Your allowance renews on your next cycle date, or you can upgrade your plan. " + SEEDLING
    });
  }

  const reservationId = reserveResult.row.reservation_id;

  // ---------- 5. GENERATE (Math + interactive gets server-authoritative
  //               validation with at most one internal retry) ----------
  async function callAnthropicOnce() {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      const msg = (aiData.error && aiData.error.message) || "AI generation failed";
      return { ok: false, error: msg, inputTokens: 0, outputTokens: 0 };
    }

    const text = (aiData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const usage = aiData.usage || {};
    return {
      ok: true,
      text,
      inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
      outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0
    };
  }

  async function finalizeValidated(inputTokens, outputTokens) {
    return callRpc("finalize_validated_generation", {
      p_reservation_id: reservationId,
      p_user_id: userId,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens
    });
  }

  // Deliberately NOT an RPC: marking a reservation FAILED only ever RELEASES
  // capacity, it can never wrongly grant something a concurrent request is
  // also counting on, so it doesn't need the lock/expiry-check machinery
  // finalize_validated_generation needs. Already restricted to service_role
  // by RLS (usage_logs has no UPDATE policy for anon/authenticated at all)
  // and further scoped here by id+user_id.
  async function finalizeFailed(inputTokens, outputTokens, validationStatus) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/usage_logs?id=eq.${reservationId}&user_id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          is_chargeable: false,
          validation_status: validationStatus,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          reservation_expires_at: null
        })
      }
    );
    return res.ok;
  }

  const isMathStructured = subject === "Math";

  try {
    let attempt = await callAnthropicOnce();
    let sumInputTokens = attempt.inputTokens || 0;
    let sumOutputTokens = attempt.outputTokens || 0;

    if (!attempt.ok) {
      await finalizeFailed(sumInputTokens, sumOutputTokens, "provider_error");
      return json(502, { error: attempt.error });
    }

    if (!isMathStructured) {
      // Every other subject: unchanged end-user behavior -- one call, one
      // chargeable row -- just routed through the same atomic reservation
      // the quota-race fix requires for every request, Math or not.
      const fin = await finalizeValidated(sumInputTokens, sumOutputTokens);
      if (!fin.ok || !fin.row || !fin.row.finalized) {
        // Per item 3: never return content whose chargeable record we
        // couldn't confirm was persisted.
        return json(503, { error: "We generated your worksheet but could not confirm it. Please try again." });
      }
      return json(200, { result: attempt.text });
    }

    // ---- Math (interactive AND printable) from here down. app.js always ----
    // requests the same structured JSON for Math regardless of mode, so
    // there is nothing mode-specific left to branch on here.
    function tryValidate(rawText) {
      try {
        const quiz = parseQuizJson(rawText);
        return validateMathQuestions(quiz, parsedItemCount);
      } catch (e) {
        return { ok: false, failures: [{ index: -1, reasons: ["JSON parse error: " + e.message] }] };
      }
    }

    let validation = tryValidate(attempt.text);

    if (!validation.ok) {
      console.warn("[MathValidation] server attempt 1 failed:", JSON.stringify(validation.failures));

      const retryResult = await callRpc("reserve_provider_retry", {
        p_reservation_id: reservationId,
        p_user_id: userId,
        p_attempt_since: attemptSince.toISOString(),
        p_attempt_limit: MAX_PROVIDER_ATTEMPTS_PER_DAY
      });
      const retryAllowed = retryResult.ok && retryResult.row && retryResult.row.allowed;

      if (!retryAllowed) {
        // Budget exhausted, reservation expired, or already used -- give up
        // with only the one attempt that already happened.
        await finalizeFailed(sumInputTokens, sumOutputTokens, "failed_validation");
        return json(502, {
          error: "We had trouble generating fully accurate Math questions this time. Please try again."
        });
      }

      attempt = await callAnthropicOnce();
      sumInputTokens += attempt.inputTokens || 0;
      sumOutputTokens += attempt.outputTokens || 0;

      if (!attempt.ok) {
        await finalizeFailed(sumInputTokens, sumOutputTokens, "provider_error");
        return json(502, { error: attempt.error });
      }

      validation = tryValidate(attempt.text);

      if (!validation.ok) {
        console.warn("[MathValidation] server retry also failed:", JSON.stringify(validation.failures));
        await finalizeFailed(sumInputTokens, sumOutputTokens, "failed_validation");
        return json(502, {
          error: "We had trouble generating fully accurate Math questions this time. Please try again."
        });
      }
    }

    const fin = await finalizeValidated(sumInputTokens, sumOutputTokens);
    if (!fin.ok || !fin.row || !fin.row.finalized) {
      // Covers a failed HTTP call AND an explicit finalized:false (e.g. the
      // reservation expired while we were validating) -- never deliver
      // either way, per the V1 policy of discarding late successes.
      return json(503, { error: "Your request took too long and expired. Please try again." });
    }

    return json(200, { result: attempt.text });
  } catch (err) {
    return json(500, { error: "Generation failed: " + err.message });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

// ---------------------------------------------------------------------
// Design note (not code): `prompt` above is still built entirely client-
// side in app.js and forwarded here verbatim. That means a modified client
// could send ANY prompt text, using this project's API key and account
// standing, completely bypassing every guardrail (Math rules, language
// rules, dysgraphia formatting) since none of them are enforced server-
// side today. The item-count allowlist and attempt ceiling in this file
// bound HOW MANY calls happen and reject obviously-malformed shape, but
// they do not constrain WHAT'S IN an otherwise-well-formed request.
// Recommended follow-up: move prompt construction here entirely, so
// generate.js receives only structured parameters (grade, subject, topic,
// difficulty, activity, items, supportFlags) and builds the prompt itself
// -- the same trust shift already applied to Math validation. Until that
// lands, every client-supplied field should be treated as untrusted, which
// in practice means: keep the items allowlist above, validate subject/mode
// against fixed allowlists rather than bare equality checks, and consider
// a hard length cap on the incoming prompt string as a cheap interim brake
// on cost-inflation attacks.
// ---------------------------------------------------------------------

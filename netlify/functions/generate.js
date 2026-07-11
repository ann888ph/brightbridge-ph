// netlify/functions/generate.js
// BrightBridge PH — worksheet generation with SERVER-SIDE quota enforcement.
//
// Required Netlify environment variables:
//   ANTHROPIC_API_KEY          — existing (double-check the name matches your current file!)
//   SUPABASE_URL               — https://jyoczjbiskgxuupdcnff.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  — NEW! From Supabase Dashboard > Settings > API > service_role
//                                (NEVER put this in index.html — server-side only!)

const PLAN_LIMITS = {
  free: 5,
  parent: 20,
  family_plus: 60,
  teacher: 150
};

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

  const { prompt, subject, mode } = body;
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

  // Verify token -> get user
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!userRes.ok) {
    return json(401, { error: "Your session has expired. Please log in again." });
  }
  const user = await userRes.json();
  const userId = user.id;
  const userEmail = user.email;

  // ---------- 2. LOAD PLAN + CYCLE START (service role bypasses RLS) ----------
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=plan,cycle_start`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const profiles = profileRes.ok ? await profileRes.json() : [];
  const plan = (profiles[0] && profiles[0].plan) || "free";
  const cycleStart = profiles[0] && profiles[0].cycle_start;

  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  // Same fallback logic as the frontend: start of calendar month if no cycle_start
  let sinceDate;
  if (cycleStart) {
    sinceDate = new Date(cycleStart);
  } else {
    sinceDate = new Date();
    sinceDate.setDate(1);
    sinceDate.setHours(0, 0, 0, 0);
  }

  // ---------- 3. COUNT USAGE SERVER-SIDE ----------
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/usage_logs?user_id=eq.${userId}&created_at=gte.${sinceDate.toISOString()}&select=id`,
    {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "count=exact",
        Range: "0-0"
      }
    }
  );
  // Supabase returns total in Content-Range header: "0-0/37"
  const contentRange = countRes.headers.get("content-range") || "/0";
  const used = parseInt(contentRange.split("/")[1], 10) || 0;

  if (used >= limit) {
    return json(429, {
      error: "You've reached your monthly worksheet limit. Your allowance renews on your next cycle date, or you can upgrade your plan. \uD83C\uDF31"
    });
  }

  // ---------- 4. GENERATE with Claude ----------
  try {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",   // matches your current production model
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      const msg = (aiData.error && aiData.error.message) || "AI generation failed";
      return json(502, { error: msg });
    }

    const result = (aiData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // ---------- 5. LOG USAGE SERVER-SIDE (cannot be skipped by the client) ----------
    await fetch(`${SUPABASE_URL}/rest/v1/usage_logs`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        user_id: userId,
        email: userEmail,
        subject: subject || null,
        mode: mode || null
      })
    });

    return json(200, { result });
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

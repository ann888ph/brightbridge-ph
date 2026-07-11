// netlify/functions/admin-stats.js
// Returns aggregated analytics for BrightBridge PH.
// SERVER-SIDE gated: only the hardcoded ADMIN_EMAIL can ever get data back,
// no matter who calls this endpoint or with what token.

const ADMIN_EMAIL = "888annph@gmail.com";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ---------- 1. AUTHENTICATE ----------
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return json(401, { error: "Please log in." });
  }

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!userRes.ok) {
    return json(401, { error: "Your session has expired. Please log in again." });
  }
  const user = await userRes.json();

  // ---------- 2. AUTHORIZE: admin email only ----------
  if ((user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return json(403, { error: "You don't have access to this page." });
  }

  // ---------- 3. FETCH RAW ROWS (service role bypasses RLS) ----------
  try {
    const usageRes = await fetch(
      `${SUPABASE_URL}/rest/v1/usage_logs?select=subject,grade,topic,difficulty,activity_type,dysgraphia_support,simplified_support,attention_support,processing_support,created_at&order=created_at.desc&limit=5000`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const usageRows = usageRes.ok ? await usageRes.json() : [];

    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=plan`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const profileRows = profilesRes.ok ? await profilesRes.json() : [];

    // ---------- 4. AGGREGATE ----------
    const stats = aggregate(usageRows, profileRows);

    return json(200, stats);
  } catch (err) {
    return json(500, { error: "Failed to load analytics: " + err.message });
  }
};

function aggregate(usageRows, profileRows) {
  const count = (arr, keyFn) => {
    const map = {};
    for (const row of arr) {
      const key = keyFn(row);
      if (key === null || key === undefined || key === "") continue;
      map[key] = (map[key] || 0) + 1;
    }
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  };

  const topSubjects = count(usageRows, (r) => r.subject);
  const topGrades = count(usageRows, (r) => r.grade);
  const topTopics = count(usageRows, (r) => (r.topic ? `${r.subject || "?"} — ${r.topic}` : null)).slice(0, 15);
  const topDifficulty = count(usageRows, (r) => r.difficulty);
  const topActivityType = count(usageRows, (r) => r.activity_type);
  const planDistribution = count(profileRows, (r) => r.plan || "free");

  const supportUsage = [
    { label: "Dysgraphia-Friendly", value: usageRows.filter((r) => r.dysgraphia_support).length },
    { label: "Simplified Instructions", value: usageRows.filter((r) => r.simplified_support).length },
    { label: "Short Attention Span", value: usageRows.filter((r) => r.attention_support).length },
    { label: "Slow Processing", value: usageRows.filter((r) => r.processing_support).length }
  ].sort((a, b) => b.value - a.value);

  // Daily generations, last 14 days
  const dayMap = {};
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayMap[key] = 0;
  }
  for (const row of usageRows) {
    if (!row.created_at) continue;
    const key = row.created_at.slice(0, 10);
    if (key in dayMap) dayMap[key]++;
  }
  const dailyGenerations = Object.entries(dayMap).map(([date, value]) => ({ date, value }));

  return {
    totalGenerations: usageRows.length,
    totalUsers: profileRows.length,
    generationsWithGradeData: usageRows.filter((r) => r.grade).length,
    topSubjects,
    topGrades,
    topTopics,
    topDifficulty,
    topActivityType,
    supportUsage,
    planDistribution,
    dailyGenerations
  };
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

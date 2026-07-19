// Verifies app.js's loadPlanAndUsage() query only counts is_chargeable=true
// rows, using a fake Supabase query-builder that actually FILTERS a dataset
// (not a no-op chain stub) so this is a real behavioral check, not just
// "was .eq() called." Loads the REAL app.js via the shared helper.
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

// Synthetic usage_logs rows: 3 validated (chargeable) + 2 failed/provider_error
// (non-chargeable) all within the cycle window.
const FAKE_ROWS = [
  { id: 1, user_id: 'user-1', is_chargeable: true, created_at: new Date().toISOString() },
  { id: 2, user_id: 'user-1', is_chargeable: true, created_at: new Date().toISOString() },
  { id: 3, user_id: 'user-1', is_chargeable: true, created_at: new Date().toISOString() },
  { id: 4, user_id: 'user-1', is_chargeable: false, created_at: new Date().toISOString() }, // failed_validation
  { id: 5, user_id: 'user-1', is_chargeable: false, created_at: new Date().toISOString() }  // provider_error
];

function makeRealQueryBuilder(table, rows) {
  const filters = { eq: {}, gte: {} };
  const builder = {
    select(_cols, opts) {
      builder._countMode = opts && opts.count === 'exact';
      return builder;
    },
    eq(col, val) { filters.eq[col] = val; return builder; },
    gte(col, val) { filters.gte[col] = val; return builder; },
    order() { return builder; },
    single: async () => ({ data: null }),
    then(resolve) {
      // Actually apply the filters -- this is the point of this test.
      const filtered = rows.filter((r) => {
        for (const k in filters.eq) if (r[k] !== filters.eq[k]) return false;
        for (const k in filters.gte) if (!(r[k] >= filters.gte[k])) return false;
        return true;
      });
      resolve({ count: filtered.length, data: filtered });
    }
  };
  return builder;
}

const sandbox = createAppSandbox({
  document: makeDocument(),
  window: {
    supabase: {
      createClient: () => ({
        auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} },
        from: (table) => ({
          select: (cols, opts) => makeRealQueryBuilder(table, FAKE_ROWS).select(cols, opts)
        })
      })
    }
  },
  extraCode: `
function __test_setCurrentUser(u) { currentUser = u; }
function __test_getCurrentUsageCount() { return currentUsageCount; }
async function __test_runLoadPlanAndUsage() { await loadPlanAndUsage(); }
`
});
sandbox.__test_setCurrentUser({ id: 'user-1' });

(async () => {
  await run('client quota display counts ONLY is_chargeable=true rows (3, not 5)', async () => {
    await sandbox.__test_runLoadPlanAndUsage();
    const count = sandbox.__test_getCurrentUsageCount();
    assert(count === 3, 'expected currentUsageCount to be 3 (only chargeable rows), got ' + count);
  });

  console.log('\nDone.');
})();

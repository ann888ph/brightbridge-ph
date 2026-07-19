// tests/helpers/run.js
//
// Shared, minimal test-runner primitives used by every suite in tests/.
// No external framework/dependency -- plain Node, matching this project's
// zero-build-step convention.
//
// run() supports both sync and async test functions. For a sync function,
// PASS/FAIL prints immediately (no microtask delay), preserving output
// order for suites that never `await run(...)`. For an async function
// (fn() returns a thenable), run() chains onto it and ALSO returns a
// promise, so callers that need strict ordering can `await run(...)` --
// this is what a purely synchronous try/catch would miss: an assertion
// that throws after an `await` inside an async test would otherwise become
// an unhandled promise rejection instead of a clean, reported FAIL.

function run(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => console.log('PASS:', label),
        (e) => console.log('FAIL:', label, '->', e.message)
      );
    }
    console.log('PASS:', label);
    return Promise.resolve();
  } catch (e) {
    console.log('FAIL:', label, '->', e.message);
    return Promise.resolve();
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

module.exports = { run, assert };

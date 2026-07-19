// tests/run-all.js
//
// Runs every suite in this directory (each is a plain Node script that
// prints "PASS: ..."/"FAIL: ..." lines and a trailing "Done."), aggregates
// a total pass/fail count, and exits non-zero if any suite has a failure
// or crashes outright. No test framework, no external dependency -- run
// with:
//
//   node tests/run-all.js
//
// Path handling is repository-relative (via __dirname), so this works
// regardless of the current working directory.

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const TESTS_DIR = __dirname;

const SUITES = [
  'test_math_validation.js',
  'test_prompt_build.js',
  'test_generate_function.js',
  'test_wiring.js',
  'test_quota_display.js',
  'test_printable_math_render.js',
  'test_topic_validation.js',
  'test_generate_topic.js',
  'test_topic_ui.js',
  'test_catalog_compatibility.js'
];

function runSuite(fileName) {
  return new Promise((resolve) => {
    const fullPath = path.join(TESTS_DIR, fileName);
    let stdout = '';
    let stderr = '';

    const child = fork(fullPath, [], { stdio: 'pipe' });
    child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });

    child.on('exit', (code) => {
      const passCount = (stdout.match(/^PASS:/gm) || []).length;
      const failCount = (stdout.match(/^FAIL:/gm) || []).length;
      const crashed = code !== 0 && failCount === 0 && !/\nDone\.\s*$/.test(stdout);
      resolve({ fileName, passCount, failCount, crashed, exitCode: code, stderr });
    });
  });
}

(async () => {
  console.log(`Running ${SUITES.length} suites from ${TESTS_DIR}\n`);

  const results = [];
  for (const fileName of SUITES) {
    if (!fs.existsSync(path.join(TESTS_DIR, fileName))) {
      console.error(`\nERROR: suite file not found: ${fileName}`);
      results.push({ fileName, passCount: 0, failCount: 0, crashed: true, exitCode: null, stderr: 'file not found' });
      continue;
    }
    console.log(`\n=== ${fileName} ===`);
    const result = await runSuite(fileName);
    results.push(result);
  }

  console.log('\n\n========== SUMMARY ==========');
  let totalPass = 0;
  let totalFail = 0;
  let anyFailure = false;

  results.forEach((r) => {
    totalPass += r.passCount;
    totalFail += r.failCount;
    const status = r.crashed ? 'CRASHED' : (r.failCount > 0 ? 'FAILED' : 'OK');
    if (r.crashed || r.failCount > 0) anyFailure = true;
    console.log(`${status.padEnd(8)} ${r.fileName.padEnd(35)} pass=${r.passCount} fail=${r.failCount}${r.crashed ? '  (see stderr above)' : ''}`);
  });

  console.log('------------------------------');
  console.log(`TOTAL: ${totalPass} passing, ${totalFail} failing, across ${results.length} suites`);

  if (anyFailure) {
    console.log('\nRESULT: FAILED -- at least one suite has a failing test or crashed. See above for which suite.');
    process.exit(1);
  } else {
    console.log('\nRESULT: ALL SUITES PASSED');
    process.exit(0);
  }
})();

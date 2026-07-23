// Required-field UX tests. Exercises the real app.js validation path with
// the shared fake DOM; no network, Supabase, quota, or AI call is made.

const fs = require('fs');
const path = require('path');
const { createAppSandbox } = require('./helpers/load-app-sandbox.js');
const { makeDocument } = require('./helpers/fake-dom.js');
const { run, assert } = require('./helpers/run.js');

function makeSandbox(values) {
  const document = makeDocument({
    values: Object.assign({
      grade: 'Grade 1',
      quarter: 'Quarter 2',
      subject: 'Language',
      topic: 'Ang Aking Pamilya at Tahanan',
      activity: 'Multiple Choice Quiz',
      items: '5',
      difficulty: 'Standard'
    }, values)
  });
  let fetchCalls = 0;
  const sandbox = createAppSandbox({
    document,
    fetch: async () => {
      fetchCalls++;
      throw new Error('required-field validation should stop before fetch');
    }
  });
  return { sandbox, document, getFetchCalls: () => fetchCalls };
}

(async () => {
  await run('one missing field names Difficulty, highlights it, and focuses it', async () => {
    const { sandbox, document, getFetchCalls } = makeSandbox({ difficulty: '' });
    await sandbox.generateWorksheet();

    const difficulty = document.getElementById('difficulty');
    assert(document.getElementById('errorMsg').textContent.includes('Please select Difficulty before generating.'), 'expected a field-specific Difficulty message');
    assert(difficulty.classList.contains('field-invalid'), 'expected Difficulty to be highlighted');
    assert(difficulty.getAttribute('aria-invalid') === 'true', 'expected aria-invalid on Difficulty');
    assert(document.activeElement === difficulty, 'expected focus to move to Difficulty');
    assert(getFetchCalls() === 0, 'expected no network call');
  });

  await run('multiple missing fields are listed and the first missing field receives focus', async () => {
    const { sandbox, document, getFetchCalls } = makeSandbox({
      grade: '',
      subject: '',
      topic: ''
    });
    await sandbox.generateWorksheet();

    const message = document.getElementById('errorMsg').textContent;
    assert(message.includes('Please complete: Grade Level, Subject, and Topic / Lesson.'), 'expected all missing fields to be named');
    ['grade', 'subject', 'topic'].forEach((id) => {
      assert(document.getElementById(id).classList.contains('field-invalid'), 'expected ' + id + ' to be highlighted');
    });
    assert(document.activeElement === document.getElementById('grade'), 'expected focus on the first missing field');
    assert(getFetchCalls() === 0, 'expected no network call');
  });

  await run('correcting a highlighted field clears its invalid state and the error message', async () => {
    const { sandbox, document } = makeSandbox({ difficulty: '' });
    await sandbox.generateWorksheet();

    const difficulty = document.getElementById('difficulty');
    difficulty.value = 'Standard';
    sandbox.clearRequiredFieldError('difficulty');

    assert(!difficulty.classList.contains('field-invalid'), 'expected highlight to clear');
    assert(difficulty.getAttribute('aria-invalid') === null, 'expected aria-invalid to clear');
    assert(!document.getElementById('errorMsg').classList.contains('visible'), 'expected the generic error panel to close');
  });

  run('required dropdown labels are explicitly associated with their controls', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ['grade', 'subject', 'topic', 'activity', 'items', 'difficulty'].forEach((id) => {
      assert(html.includes('<label for="' + id + '">'), 'expected label for="' + id + '"');
    });
  });

  console.log('\nDone.');
})();

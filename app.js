/* ============ SUPABASE SETUP ============ */
const SUPABASE_URL = 'https://jyoczjbiskgxuupdcnff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_G8GcsQSqHkSBj7fmJtJejA_NjlREZyE';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let authMode = 'login';
let wsMode = 'printable';
let currentQuiz = null;
let userAnswers = {};

/* ============ AUTH ============ */
async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    currentUser = session.user;
    showApp();
  }
  db.auth.onAuthStateChange((_event, session) => {
    if (_event === 'PASSWORD_RECOVERY') {
      const newPass = prompt('Welcome back! Enter your new password:');
      if (newPass && newPass.length >= 6) {
        db.auth.updateUser({ password: newPass }).then(() => alert('Password updated! You are now signed in.'));
      } else if (newPass) {
        alert('Password must be at least 6 characters. Please use Forgot password again.');
      }
    }
    if (session) {
      currentUser = session.user;
      showApp();
    } else {
      currentUser = null;
      showAuth();
    }
  });
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('userEmail').textContent = currentUser.email;
  loadWorksheets();
  loadPlanAndUsage();
}

function clearSessionState() {
  currentQuiz = null;
  userAnswers = {};
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  document.getElementById('worksheetOutput').innerHTML = '';
  document.getElementById('interactiveArea').innerHTML = '';
  document.getElementById('output-section').classList.remove('visible');
  document.getElementById('savedBadge').classList.remove('visible');
  document.getElementById('wsList').innerHTML = '';
  document.getElementById('wsCount').textContent = '0 saved';
  document.getElementById('errorMsg').classList.remove('visible');
  // Reset the form so the next user starts fresh
  document.getElementById('grade').value = '';
  document.getElementById('quarter').value = 'Quarter 1';
  document.getElementById('subject').innerHTML = '<option value="">Select Grade First</option>';
  document.getElementById('topic').innerHTML = '<option value="">Select Topic</option>';
  const strayTopic = document.getElementById('topicCustom');
  if (strayTopic) strayTopic.remove();
  document.getElementById('activity').value = '';
  document.getElementById('items').value = '';
  document.getElementById('difficulty').value = '';
  ['dysgraphia', 'simplified', 'attention', 'processing'].forEach(id => {
    document.getElementById(id).checked = false;
  });
  setMode('printable');
  currentPlan = 'free';
  currentUsageCount = 0;
  currentCycleStart = null;
  document.getElementById('quotaBlocked').classList.remove('visible');
}

function showAuth() {
  clearSessionState();
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  document.getElementById('authHeading').textContent = authMode === 'login' ? 'Welcome Back' : 'Create Your Account';
  document.getElementById('authBtn').textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
  document.getElementById('authSub').textContent = authMode === 'login'
    ? 'Sign in to create worksheets for your learner.'
    : 'Free to join. Start supporting your learner today.';
  document.getElementById('authToggle').innerHTML = authMode === 'login'
    ? 'New here? <a onclick="toggleAuthMode()">Create an account</a>'
    : 'Already have an account? <a onclick="toggleAuthMode()">Sign in</a>';
  authMsg('', '');
}

function authMsg(text, type) {
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className = 'auth-msg' + (type ? ' ' + type : '');
}

function togglePassword() {
  const input = document.getElementById('authPassword');
  const eye = document.getElementById('pwEye');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  eye.classList.toggle('on', !showing);
  eye.title = showing ? 'Show password' : 'Hide password';
}

async function handleForgotPassword() {
  const email = document.getElementById('authEmail').value.trim();
  if (!email) {
    authMsg('Type your email above first, then click Forgot password.', 'error');
    return;
  }
  try {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://brightbridgeph.netlify.app'
    });
    if (error) throw error;
    authMsg('Password reset email sent to ' + email + '. Please check your inbox.', 'success');
  } catch (err) {
    authMsg(err.message, 'error');
  }
}

async function handleAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!email || !password) {
    authMsg('Please enter your email and password.', 'error');
    return;
  }
  const btn = document.getElementById('authBtn');
  const restoreText = btn.textContent;
  btn.disabled = true;
  btn.textContent = authMode === 'login' ? 'Signing in...' : 'Creating account...';
  try {
    if (authMode === 'signup') {
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        authMsg('Account created! Please check your email to confirm, then sign in. \uD83D\uDCE7', 'success');
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    authMsg(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = restoreText;
  }
}

async function handleLogout() {
  await db.auth.signOut();
}

/* ============ MODE TOGGLE ============ */
function setMode(mode) {
  wsMode = mode;
  document.getElementById('modePrintable').classList.toggle('active', mode === 'printable');
  document.getElementById('modeInteractive').classList.toggle('active', mode === 'interactive');
  document.getElementById('modeDesc').textContent = mode === 'printable'
    ? 'Print-ready worksheet \u2014 perfect for pen and paper practice.'
    : 'Answer on screen with instant checking \u2014 perfect for laptop or tablet! No handwriting needed. \uD83D\uDC9B';
}

/* ============ PLANS & QUOTA ============ */
const PLAN_LIMITS = {
  free: { label: 'Free Plan', limit: 5 },
  parent: { label: 'Parent Plan', limit: 20 },
  family_plus: { label: 'Family Plus', limit: 60 },
  teacher: { label: 'Teacher Plan', limit: 150 }
};

let currentPlan = 'free';
let currentUsageCount = 0;
let currentCycleStart = null;

async function loadPlanAndUsage() {
  // 1. Get the user's plan and billing cycle start from profiles
  let cycleStart = null;
  try {
    const { data: profile } = await db.from('profiles').select('plan, cycle_start').eq('user_id', currentUser.id).single();
    currentPlan = (profile && profile.plan) || 'free';
    cycleStart = profile && profile.cycle_start;
  currentCycleStart = cycleStart;
  } catch (e) {
    currentPlan = 'free';
  }

  // 2. Count generations since the user's cycle_start (set by admin on signup/renewal/upgrade).
  //    Falls back to start of calendar month if no cycle_start is set yet.
  let sinceDate;
  if (cycleStart) {
    sinceDate = new Date(cycleStart);
  } else {
    sinceDate = new Date();
    sinceDate.setDate(1);
    sinceDate.setHours(0, 0, 0, 0);
  }

  try {
    const { count } = await db.from('usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .gte('created_at', sinceDate.toISOString());
    currentUsageCount = count || 0;
  } catch (e) {
    currentUsageCount = 0;
  }

  renderQuota();
}

function renderQuota() {
  const plan = PLAN_LIMITS[currentPlan] || PLAN_LIMITS.free;
  const used = currentUsageCount;
  const limit = plan.limit;
  const pct = Math.min(100, Math.round((used / limit) * 100));

  document.getElementById('quotaCount').textContent = used + ' of ' + limit + ' used';
  document.getElementById('quotaPlanBadge').textContent = plan.label;

  const renewEl = document.getElementById('quotaRenew');
  const blockedTextEl = document.getElementById('quotaBlockedText');
  if (currentCycleStart) {
    const renewDate = new Date(currentCycleStart);
    renewDate.setMonth(renewDate.getMonth() + 1);
    const renewLabel = renewDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    renewEl.textContent = '\uD83D\uDD04 Renews ' + renewLabel;
    blockedTextEl.textContent = 'Your worksheet allowance renews on ' + renewLabel + '.';
  } else {
    renewEl.textContent = '';
    blockedTextEl.textContent = 'Your plan resets on your next renewal date.';
  }

  const fill = document.getElementById('quotaFill');
  fill.style.width = pct + '%';
  fill.className = 'quota-fill' + (pct >= 100 ? ' full' : pct >= 80 ? ' warn' : '');

  const blocked = document.getElementById('quotaBlocked');
  const genBtn = document.getElementById('generateBtn');
  if (used >= limit) {
    blocked.classList.add('visible');
    genBtn.disabled = true;
    genBtn.style.opacity = '0.5';
  } else {
    blocked.classList.remove('visible');
    genBtn.disabled = false;
    genBtn.style.opacity = '1';
  }
}

function hasQuotaRemaining() {
  const plan = PLAN_LIMITS[currentPlan] || PLAN_LIMITS.free;
  return currentUsageCount < plan.limit;
}

/* ============ WORKSHEET STORAGE ============ */
async function saveWorksheet(title, grade, subject, topic, content, mode) {
  const { error } = await db.from('worksheets').insert({
    user_id: currentUser.id,
    title, grade, subject, topic, content, mode
  });
  if (!error) {
    document.getElementById('savedBadge').classList.add('visible');
    loadWorksheets();
  }
}

async function logUsage(subject, mode) {
  try {
    await db.from('usage_logs').insert({
      user_id: currentUser.id,
      email: currentUser.email,
      subject: subject,
      mode: mode
    });
  } catch (e) {
    // Logging should never break the app
    console.error('Usage log failed', e);
  }
}

async function loadWorksheets() {
  const { data, error } = await db.from('worksheets')
    .select('id, title, grade, subject, topic, mode, created_at')
    .order('created_at', { ascending: false });

  const list = document.getElementById('wsList');
  const count = document.getElementById('wsCount');

  if (error || !data || data.length === 0) {
    list.innerHTML = '<div class="ws-empty">No saved worksheets yet. Generate one and it will appear here! \uD83C\uDF31</div>';
    count.textContent = '0 saved';
    return;
  }

  count.textContent = data.length + ' saved';
  list.innerHTML = data.map(ws => {
    const date = new Date(ws.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    const modeIcon = ws.mode === 'interactive' ? '\uD83D\uDCBB' : '\uD83D\uDDA8\uFE0F';
    return `
    <div class="ws-item">
      <div class="ws-info">
        <div class="ws-title">${modeIcon} ${ws.title}</div>
        <div class="ws-meta">${ws.grade} &middot; ${ws.subject} &middot; ${date}</div>
      </div>
      <div class="ws-actions">
        <button class="ws-btn view" onclick="viewWorksheet('${ws.id}')">\uD83D\uDC41\uFE0F View</button>
        <button class="ws-btn del" onclick="deleteWorksheet('${ws.id}')">\uD83D\uDDD1\uFE0F</button>
      </div>
    </div>`;
  }).join('');
}

async function viewWorksheet(id) {
  const { data, error } = await db.from('worksheets').select('content, mode').eq('id', id).single();
  if (error || !data) return;
  document.getElementById('savedBadge').classList.remove('visible');

  if (data.mode === 'interactive') {
    try {
      currentQuiz = JSON.parse(data.content);
      renderInteractive(currentQuiz);
    } catch (e) {
      showError('Could not load interactive worksheet.');
      return;
    }
  } else {
    showPrintable(data.content);
  }
  document.getElementById('output-section').classList.add('visible');
  document.getElementById('output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteWorksheet(id) {
  if (!confirm('Delete this worksheet? This cannot be undone.')) return;
  await db.from('worksheets').delete().eq('id', id);
  loadWorksheets();
}

/* ============ TOPICS ============ */
const gradeTopicsCache = {};

function gradeFileName(grade) {
  // "Grade 1" -> "grade1-topics.json"
  const n = grade.replace(/\D/g, '');
  return '/grade' + n + '-topics.json';
}

async function loadGradeTopics(grade) {
  if (gradeTopicsCache[grade]) return gradeTopicsCache[grade];
  const res = await fetch(gradeFileName(grade));
  if (!res.ok) throw new Error('Could not load curriculum data for ' + grade);
  const data = await res.json();
  gradeTopicsCache[grade] = data;
  return data;
}

async function updateSubjects() {
  const grade = document.getElementById('grade').value;
  const subjectSelect = document.getElementById('subject');
  const topicSelect = document.getElementById('topic');

  subjectSelect.innerHTML = '<option value="">Select Subject</option>';
  topicSelect.innerHTML = '<option value="">Select Topic</option>';

  if (!grade) return;

  subjectSelect.innerHTML = '<option value="">Loading subjects...</option>';
  subjectSelect.disabled = true;

  try {
    const data = await loadGradeTopics(grade);
    subjectSelect.innerHTML = '<option value="">Select Subject</option>';
    Object.keys(data).forEach(subj => {
      const opt = document.createElement('option');
      opt.value = subj; opt.textContent = subj;
      subjectSelect.appendChild(opt);
    });
  } catch (e) {
    subjectSelect.innerHTML = '<option value="">Could not load subjects</option>';
    showError("Couldn't load the curriculum for " + grade + ". Please try again. \uD83C\uDF3F");
  } finally {
    subjectSelect.disabled = false;
  }
}

function updateTopics() {
  const grade = document.getElementById('grade').value;
  const subject = document.getElementById('subject').value;
  const quarter = document.getElementById('quarter').value;
  const topicSelect = document.getElementById('topic');
  topicSelect.innerHTML = '<option value="">Select Topic</option>';

  const stray = document.getElementById('topicCustom');
  if (stray) stray.remove();

  if (!grade || !subject) return;

  const data = gradeTopicsCache[grade];
  const subjectData = data && data[subject];
  const gradeData = subjectData && subjectData[grade];

  if (!gradeData) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No topic list yet - type your own below';
    opt.disabled = true;
    topicSelect.appendChild(opt);
    topicSelect.insertAdjacentHTML('afterend',
      '<input type="text" id="topicCustom" placeholder="Type a topic (e.g. Counting 1-20)" style="margin-top:8px;" />');
    return;
  }

  const list = gradeData[quarter] || gradeData.all || [];
  list.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    topicSelect.appendChild(opt);
  });
}

/* ============ OUTPUT RENDERING ============ */
function showPrintable(html) {
  document.getElementById('worksheetOutput').innerHTML = html;
  document.getElementById('worksheetOutput').style.display = 'block';
  document.getElementById('interactiveArea').innerHTML = '';
  document.getElementById('printableActions').style.display = 'flex';
  document.getElementById('outputTitle').textContent = '\uD83D\uDCC4 Your Generated Worksheet';
}

function renderInteractive(quiz) {
  userAnswers = {};
  document.getElementById('worksheetOutput').style.display = 'none';
  document.getElementById('worksheetOutput').innerHTML = '';
  document.getElementById('printableActions').style.display = 'none';
  document.getElementById('outputTitle').textContent = '\uD83D\uDCBB ' + (quiz.title || 'Interactive Worksheet');

  const area = document.getElementById('interactiveArea');
  let html = `<p style="font-size:14px; color:var(--muted); font-weight:600; margin-bottom:18px;">${quiz.directions || 'Answer each question, then click Check Answers!'}</p>`;

  const isReadingType = /reading|comprehension/i.test(quiz.activityType || document.getElementById('activity').value || '');
  if (typeof quiz.passage === 'string' && quiz.passage.trim().length > 0) {
    html += `<div class="iq-passage">
      <div class="iq-passage-head">
        <div class="iq-passage-title">\uD83D\uDCD6 Read the Story</div>
        <button class="iq-speak" id="passageSpk" onclick="speakPassage()" title="Read the story aloud">\uD83D\uDD0A</button>
      </div>
      <div class="iq-passage-text">${escapeHtml(quiz.passage)}</div>
    </div>`;
  } else if (isReadingType) {
    // AC 18: safe fallback if a reading activity is missing its passage, instead of a silent gap or crash
    html += `<div class="iq-passage" style="text-align:center; color:var(--muted);">
      <div class="iq-passage-title" style="margin-bottom:6px;">\uD83D\uDCD6 Story unavailable</div>
      <div style="font-size:13px;">This worksheet's story could not be loaded. Try generating it again.</div>
    </div>`;
  }

  quiz.questions.forEach((q, i) => {
    html += `<div class="iq-question" id="q${i}">`;
    html += `<div class="iq-qhead">`;
    html += `<div class="iq-qtext"><span class="iq-qnum">${i + 1}.</span>${escapeHtml(q.question)}</div>`;
    html += `<button class="iq-speak" id="q${i}spk" onclick="speakQuestion(${i})" title="Read aloud">\uD83D\uDD0A</button>`;
    html += `</div>`;

    if (q.type === 'multiple_choice') {
      html += `<div class="iq-choices">`;
      q.choices.forEach((c, ci) => {
        html += `<button class="iq-choice" id="q${i}c${ci}" onclick="selectChoice(${i}, ${ci})">${String.fromCharCode(65 + ci)}. ${escapeHtml(c)}</button>`;
      });
      html += `</div>`;
    } else if (q.type === 'true_false') {
      html += `<div class="iq-tf">`;
      html += `<button class="iq-choice" id="q${i}cTrue" onclick="selectTF(${i}, true)">TRUE</button>`;
      html += `<button class="iq-choice" id="q${i}cFalse" onclick="selectTF(${i}, false)">FALSE</button>`;
      html += `</div>`;
    } else if (q.type === 'fill_blank') {
      html += `<input type="text" class="iq-blank" id="q${i}blank" placeholder="Type your answer here..." oninput="userAnswers[${i}] = this.value" />`;
    }

    html += `<div class="iq-feedback" id="q${i}fb"></div>`;
    html += `</div>`;
  });

  html += `<button class="iq-check-btn" id="checkBtn" onclick="checkAnswers()">\u2705 Check Answers</button>`;
  html += `<div class="iq-score" id="iqScore">
    <div class="iq-score-num" id="scoreNum"></div>
    <div class="iq-score-label" id="scoreLabel"></div>
    <button class="iq-retry" onclick="renderInteractive(currentQuiz)">\uD83D\uDD04 Try Again</button>
  </div>`;

  area.innerHTML = html;
}

function speakPassage() {
  if (!window.speechSynthesis) return;
  const btn = document.getElementById('passageSpk');

  // Toggle: if already speaking the passage, stop it (AC 12: stop/restart control)
  if (btn && btn.classList.contains('speaking')) {
    window.speechSynthesis.cancel();
    btn.classList.remove('speaking');
    btn.innerHTML = '\uD83D\uDD0A';
    btn.title = 'Read the story aloud';
    return;
  }

  if (!currentQuiz || typeof currentQuiz.passage !== 'string' || !currentQuiz.passage.trim()) return;

  window.speechSynthesis.cancel();
  document.querySelectorAll('.iq-speak.speaking').forEach(b => {
    b.classList.remove('speaking');
    b.innerHTML = '\uD83D\uDD0A';
  });

  const utter = new SpeechSynthesisUtterance(currentQuiz.passage);
  const filSubjects = ['Filipino', 'Araling Panlipunan', 'GMRC / Values', 'EPP'];
  const wantFil = filSubjects.includes(currentQuiz.subject || '');
  const voices = window.speechSynthesis.getVoices();
  if (wantFil) {
    const filVoice = voices.find(v => v.lang && (v.lang.toLowerCase().startsWith('fil') || v.lang.toLowerCase().startsWith('tl')));
    if (filVoice) { utter.voice = filVoice; utter.lang = filVoice.lang; }
    else { utter.lang = 'fil-PH'; }
  } else {
    utter.lang = 'en-US';
  }
  utter.rate = 0.85;

  if (btn) { btn.classList.add('speaking'); btn.innerHTML = '\u23F9'; btn.title = 'Stop reading'; }
  utter.onend = () => { if (btn) { btn.classList.remove('speaking'); btn.innerHTML = '\uD83D\uDD0A'; btn.title = 'Read the story aloud'; } };
  utter.onerror = () => { if (btn) { btn.classList.remove('speaking'); btn.innerHTML = '\uD83D\uDD0A'; btn.title = 'Read the story aloud'; } };

  window.speechSynthesis.speak(utter);
}

function speakQuestion(qi) {
  if (!window.speechSynthesis) { alert('Read aloud is not supported on this browser.'); return; }
  const thisBtn = document.getElementById('q' + qi + 'spk');

  if (thisBtn && thisBtn.classList.contains('speaking')) {
    window.speechSynthesis.cancel();
    thisBtn.classList.remove('speaking');
    thisBtn.innerHTML = '\uD83D\uDD0A';
    return;
  }

  window.speechSynthesis.cancel();
  document.querySelectorAll('.iq-speak.speaking').forEach(b => { b.classList.remove('speaking'); b.innerHTML = '\uD83D\uDD0A'; });

  const q = currentQuiz.questions[qi];
  let text = q.question;
  if (q.type === 'multiple_choice') {
    text += '. ' + q.choices.map((c, i) => String.fromCharCode(65 + i) + '. ' + c).join('. ');
  } else if (q.type === 'true_false') {
    text += '. True... or False?';
  }

  const utter = new SpeechSynthesisUtterance(text);
  const filSubjects = ['Filipino', 'Araling Panlipunan', 'GMRC / Values', 'EPP'];
  const wantFil = filSubjects.includes(currentQuiz.subject || '');
  const voices = window.speechSynthesis.getVoices();
  if (wantFil) {
    const filVoice = voices.find(v => v.lang && (v.lang.toLowerCase().startsWith('fil') || v.lang.toLowerCase().startsWith('tl')));
    if (filVoice) { utter.voice = filVoice; utter.lang = filVoice.lang; }
    else { utter.lang = 'fil-PH'; }
  } else {
    utter.lang = 'en-US';
  }
  utter.rate = 0.85;

  const btn = document.getElementById('q' + qi + 'spk');
  if (btn) { btn.classList.add('speaking'); btn.innerHTML = '\u23F9'; }
  utter.onend = () => { if (btn) { btn.classList.remove('speaking'); btn.innerHTML = '\uD83D\uDD0A'; } };
  utter.onerror = () => { if (btn) { btn.classList.remove('speaking'); btn.innerHTML = '\uD83D\uDD0A'; } };

  window.speechSynthesis.speak(utter);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function selectChoice(qi, ci) {
  userAnswers[qi] = ci;
  const q = currentQuiz.questions[qi];
  q.choices.forEach((_, i) => {
    document.getElementById(`q${qi}c${i}`).classList.toggle('selected', i === ci);
  });
}

function selectTF(qi, val) {
  userAnswers[qi] = val;
  document.getElementById(`q${qi}cTrue`).classList.toggle('selected', val === true);
  document.getElementById(`q${qi}cFalse`).classList.toggle('selected', val === false);
}

function normalizeAnswer(s) {
  s = (s || '').toString().toLowerCase().trim();
  s = s.replace(/[.,!?;:'"]/g, '');
  s = s.replace(/^(mga|ang|si|the|a|an)\s+/, '');
  return s.trim();
}

function checkAnswers() {
  let score = 0;
  const total = currentQuiz.questions.length;

  currentQuiz.questions.forEach((q, i) => {
    const qEl = document.getElementById(`q${i}`);
    const fb = document.getElementById(`q${i}fb`);
    let correct = false;

    if (q.type === 'multiple_choice') {
      correct = userAnswers[i] === q.answer;
      const correctBtn = document.getElementById(`q${i}c${q.answer}`);
      if (correctBtn) correctBtn.classList.add('reveal-correct');
      if (!correct && userAnswers[i] !== undefined) {
        const wrongBtn = document.getElementById(`q${i}c${userAnswers[i]}`);
        if (wrongBtn) wrongBtn.classList.add('reveal-wrong');
      }
    } else if (q.type === 'true_false') {
      correct = userAnswers[i] === q.answer;
      const correctBtn = document.getElementById(`q${i}c${q.answer ? 'True' : 'False'}`);
      if (correctBtn) correctBtn.classList.add('reveal-correct');
      if (!correct && userAnswers[i] !== undefined) {
        const wrongBtn = document.getElementById(`q${i}c${userAnswers[i] ? 'True' : 'False'}`);
        if (wrongBtn) wrongBtn.classList.add('reveal-wrong');
      }
    } else if (q.type === 'fill_blank') {
      const given = normalizeAnswer(userAnswers[i]);
      const accepted = [q.answer, ...(q.alternates || [])].map(normalizeAnswer);
      correct = accepted.some(exp =>
        given === exp ||
        (given.length >= 3 && (exp.includes(given) || given.includes(exp)))
      );
    }

    if (correct) {
      score++;
      qEl.classList.add('correct');
      qEl.classList.remove('wrong');
      fb.textContent = '\u2705 Correct! Great job!';
      fb.className = 'iq-feedback show-correct';
    } else {
      qEl.classList.add('wrong');
      qEl.classList.remove('correct');
      fb.textContent = '\u274C The correct answer is: ' + formatAnswer(q);
      fb.className = 'iq-feedback show-wrong';
    }
  });

  const pct = score / total;
  let label = '';
  if (pct === 1) label = '\uD83C\uDFC6 PERFECT! Outstanding!';
  else if (pct >= 0.85) label = '\uD83C\uDF89 Very Good! Galing!';
  else if (pct >= 0.6) label = '\u2B50 Good! Keep it up!';
  else label = "\uD83C\uDF31 Let's review together! You can do it!";

  document.getElementById('scoreNum').textContent = score + ' / ' + total;
  document.getElementById('scoreLabel').textContent = label;
  document.getElementById('iqScore').classList.add('visible');
  document.getElementById('checkBtn').style.display = 'none';
  document.getElementById('iqScore').scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (pct >= 0.85) launchConfetti();
}

function formatAnswer(q) {
  if (q.type === 'multiple_choice') return String.fromCharCode(65 + q.answer) + '. ' + q.choices[q.answer];
  if (q.type === 'true_false') return q.answer ? 'TRUE' : 'FALSE';
  return q.answer;
}

function launchConfetti() {
  const colors = ['#2d9e7e', '#fde8d8', '#d4f0e8', '#f59e0b', '#ec4899', '#8b5cf6'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 5000);
  }
}

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

/* ============ GENERATE ============ */
async function generateWorksheet() {
  const grade = document.getElementById('grade').value;
  const quarter = document.getElementById('quarter').value;
  const subject = document.getElementById('subject').value;
  const topicCustomEl = document.getElementById('topicCustom');
  const topic = (topicCustomEl && topicCustomEl.value.trim()) || document.getElementById('topic').value;
  const activity = document.getElementById('activity').value;
  const items = document.getElementById('items').value;
  const difficulty = document.getElementById('difficulty').value;

  if (!grade || !subject || !topic || !activity || !items || !difficulty) {
    showError('Please fill in all required fields before generating. \uD83C\uDF3F');
    return;
  }

  if (!hasQuotaRemaining()) {
    showError("You've reached your monthly worksheet limit. Your plan resets next month, or you can upgrade for more. \uD83C\uDF31");
    document.getElementById('quotaBlocked').classList.add('visible');
    return;
  }

  const supports = [];
  if (document.getElementById('dysgraphia').checked) supports.push('Dysgraphia-Friendly Format (use large answer spaces, clear lines)');
  if (document.getElementById('simplified').checked) supports.push('Simplified Instructions (use very short and easy-to-understand directions)');
  if (document.getElementById('attention').checked) supports.push('Short Attention Span Support (chunk tasks into small sections with visual breaks)');
  if (document.getElementById('processing').checked) supports.push('Slow Processing Support (fewer items per row, generous spacing)');

  const supportNote = supports.length > 0
    ? `\n\nSpecial Learning Support Needs:\n${supports.map(s => '- ' + s).join('\n')}`
    : '';

  let prompt;
  if (wsMode === 'interactive') {
    prompt = `You are an expert Filipino elementary school teacher and curriculum designer aligned with DepEd standards.

Create an INTERACTIVE ${activity} for the following:
- Grade Level: ${grade}\n- Quarter: ${quarter} (align content to DepEd MATATAG curriculum for this quarter)
- Subject: ${subject}
- Topic: ${topic}
- Number of Items: ${items}
- Difficulty: ${difficulty}
${supportNote}

CRITICAL: Respond with ONLY a valid JSON object. No markdown, no backticks, no explanation, no text before or after. Just pure JSON in this exact structure:

{
  "title": "worksheet title here",
  "directions": "short child-friendly directions here",
  "passage": "ONLY for Reading Comprehension: the complete story text here (3-6 short paragraphs, grade-appropriate). Omit this field for other activity types.",
  "questions": [
    { "type": "multiple_choice", "question": "question text", "choices": ["choice 1", "choice 2", "choice 3", "choice 4"], "answer": 0 },
    { "type": "true_false", "question": "statement here", "answer": true },
    { "type": "fill_blank", "question": "sentence with _____ for the blank", "answer": "correct word", "alternates": ["acceptable variation 1", "acceptable variation 2"] }
  ]
}

Rules:
- "answer" for multiple_choice is the INDEX (0-3) of the correct choice
- "answer" for true_false is boolean true or false
- "answer" for fill_blank is the expected word/phrase (keep it to 1-2 words for fair checking)
- "alternates" for fill_blank: list acceptable variations a child might reasonably type (singular/plural forms, with or without "mga"/"ang", synonyms, symbol forms like ">" for "greater"). Be generous - the goal is to assess understanding, not exact wording.
- If Activity Type is Reading Comprehension: you MUST include the "passage" field with the COMPLETE story. Every question must be answerable from the passage alone. Never reference a story that is not included.
- Mix question types appropriately for the activity type requested
- Exactly ${items} questions total
- Use Filipino-friendly context (names like Nena, Juan, Aling Rosa; places like Maynila, Cebu; foods like adobo, sinigang)

LANGUAGE RULE:
- If subject is ENGLISH: use English throughout.
- If subject is MATH or SCIENCE: use English for all questions. Filipino context allowed in word problems only.
- Never write Math or Science questions fully in Filipino/Tagalog.
- If subject is FILIPINO, ARALING PANLIPUNAN, GMRC / VALUES, or EPP: write EVERYTHING in Filipino/Tagalog \u2014 directions, questions, and choices.
- If subject is MAPEH: use English as the base, Filipino terms welcome.

Output compact JSON (no unnecessary whitespace or newlines). If a token limit approaches, output fewer complete questions rather than incomplete JSON. The JSON must always be complete and parseable.`;
  } else {
    prompt = `You are an expert Filipino elementary school teacher and curriculum designer aligned with DepEd standards.

Create a ${activity} for the following:
- Grade Level: ${grade}\n- Quarter: ${quarter} (align content to DepEd MATATAG curriculum for this quarter)
- Subject: ${subject}
- Topic: ${topic}
- Number of Items: ${items}
- Difficulty: ${difficulty}
${supportNote}

IMPORTANT: Return your response as clean HTML only (no markdown, no backticks, no code fences). Use these HTML elements:
- <h1> for the worksheet title (centered)
- <p> for header info (Name, Date, Score lines) \u2014 use underscores like: Name: _______________
- <hr> to separate sections
- <ol> or <p> for numbered items
- For Multiple Choice: each choice on same line like: A. choice &nbsp;&nbsp; B. choice &nbsp;&nbsp; C. choice &nbsp;&nbsp; D. choice
- <div class="answer-key"><strong>Answer Key</strong><br>...</div> at the bottom
- Use <strong> for labels and key words
- Leave generous spacing between items

Use Filipino-friendly context (local names like Nena, Juan, Aling Rosa, places like Maynila, Cebu, foods like adobo, sinigang). Write in a warm encouraging tone.

LANGUAGE RULE: 
- If subject is ENGLISH: use English throughout.
- If subject is MATH or SCIENCE: use English as the medium of instruction for all questions, directions, and labels. Filipino context (local names, foods, places) is allowed in word problems ONLY \u2014 but the question itself must be in English.
- Never write Math or Science questions fully in Filipino/Tagalog.
- If subject is FILIPINO, ARALING PANLIPUNAN, GMRC / VALUES, or EPP: write EVERYTHING in Filipino/Tagalog \u2014 directions (Panuto), questions, and choices. This matches how these subjects are taught in DepEd schools.
- If subject is MAPEH: use English as the base, but Filipino terms are welcome (e.g., Mga Larong Pinoy, wastong nutrisyon).

CRITICAL INSTRUCTION: You may be working within a token limit. If you sense you are running out of space before finishing all items \u2014 STOP adding new items and immediately write the Answer Key section. A worksheet with fewer items but a complete Answer Key is far better than one with all items but no Answer Key. Never leave the Answer Key missing or incomplete.
${document.getElementById('dysgraphia').checked ? `
DYSGRAPHIA-FRIENDLY MODE (active for this worksheet):
Generate a worksheet that tests the same learning objective but reduces handwriting burden. Use checkboxes, circle-the-answer formats, word banks, short instructions, larger spacing, and clear sections. Avoid long written answers, crowded layouts, and unnecessary copying. The goal is to assess understanding, not handwriting endurance. Keep the content grade-appropriate and include an answer key. Do not simplify the academic skill unless requested. Only simplify the response method and visual layout.

Specific formatting rules:
- For Multiple Choice answers: replace "Answer: ______" with: <span style="font-size:1.1em;">\u2610 A &nbsp;&nbsp;&nbsp; \u2610 B &nbsp;&nbsp;&nbsp; \u2610 C &nbsp;&nbsp;&nbsp; \u2610 D</span>
- For True/False items: use <span style="font-size:1.1em;">\u2610 TRUE &nbsp;&nbsp;&nbsp; \u2610 FALSE</span>
- For Fill in the Blank: provide a word bank at the top, and use extra long blank lines (20+ underscores)
- For Identification: use checkbox squares and clear section headers
- Add generous spacing and clear visual breaks between every item` : `
STANDARD FORMAT MODE (Dysgraphia-Friendly Format is NOT requested for this worksheet):
Use normal handwritten-answer formatting \u2014 standard blank lines for answers, regular multiple choice layout (A/B/C/D on one line), normal spacing. Do NOT use checkbox squares (\u2610), do NOT provide word banks unless the activity type calls for one, and do NOT use extra-long blank lines. This is a standard worksheet.`}`;
  }

  setLoading(true);
  hideError();
  document.getElementById('savedBadge').classList.remove('visible');

  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      showError('Please log in again to generate worksheets. \uD83C\uDF3F');
      setLoading(false);
      return;
    }
    const response = await fetch("/.netlify/functions/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token
      },
      body: JSON.stringify({
        prompt, subject, mode: wsMode,
        grade, topic, difficulty, activity,
        supportFlags: {
          dysgraphia: document.getElementById('dysgraphia').checked,
          simplified: document.getElementById('simplified').checked,
          attention: document.getElementById('attention').checked,
          processing: document.getElementById('processing').checked
        }
      })
    });
    if (response.status === 429) {
      const errData = await response.json();
      showError(errData.error || "You've reached your monthly worksheet limit. \uD83C\uDF31");
      document.getElementById('quotaBlocked').classList.add('visible');
      await loadPlanAndUsage();
      setLoading(false);
      return;
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    let text = data.result || '';
    text = text.replace(/```json/gi, '').replace(/```html/gi, '').replace(/```/g, '').trim();

    const wsTitle = `${subject} \u2014 ${topic} (${grade})`;

    if (wsMode === 'interactive') {
      currentQuiz = parseQuizJson(text);
      currentQuiz.subject = subject;
      currentQuiz.activityType = activity;
      renderInteractive(currentQuiz);
      await saveWorksheet(wsTitle, grade, subject, topic, JSON.stringify(currentQuiz), 'interactive');
      currentUsageCount++; renderQuota();
    } else {
      showPrintable(text);
      await saveWorksheet(wsTitle, grade, subject, topic, text, 'printable');
      currentUsageCount++; renderQuota();
    }

    document.getElementById('output-section').classList.add('visible');
    document.getElementById('output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    if (err instanceof SyntaxError) {
      showError('The AI response was incomplete. Please try again with fewer items. \uD83C\uDF3F');
    } else {
      showError('Something went wrong: ' + err.message);
    }
  } finally {
    setLoading(false);
  }
}

function setLoading(active) {
  const btn = document.getElementById('generateBtn');
  const bar = document.getElementById('loadingBar');
  const txt = document.getElementById('loadingText');
  btn.disabled = active;
  btn.textContent = active ? '\uD83C\uDF3F Generating...' : '\u2728 Generate Worksheet';
  bar.classList.toggle('active', active);
  txt.classList.toggle('active', active);
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.add('visible');
}

function hideError() {
  document.getElementById('errorMsg').classList.remove('visible');
}

function copyText() {
  const el = document.getElementById('worksheetOutput');
  const text = el.innerText;
  navigator.clipboard.writeText(text).then(() => {
    alert('Copied to clipboard! \uD83D\uDCCB');
  });
}

/* ============ INIT ============ */
initAuth();

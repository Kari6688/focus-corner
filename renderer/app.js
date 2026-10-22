'use strict';
// Focus Corner — widget logic (to-do list, Pomodoro timer, minimized styles)

// Bridge to the main process. The fallback lets you open index.html in a browser to tweak the UI.
const api = window.focusCorner || {
  platform: 'browser',
  setMode() {}, hide() {}, quit() {}, setAlwaysOnTop() {}, setLaunchAtLogin() {},
  getLaunchAtLogin: async () => false, reportStatus() {}, onCommand() {}, onBlur() {},
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
};

/* ---------------- state ---------------- */

const DEFAULTS = {
  collapsedStyle: 'pill', // pill | bubble | tab
  focus: 25,
  short: 5,
  long: 15,
  longEvery: 4,
  autoCollapse: true,
  fadeIdle: true,
  alwaysOnTop: true,
  autoStartBreaks: false,
  sound: true,
};
const MODE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const RING_C = 2 * Math.PI * 15;

let settings = { ...DEFAULTS, ...store.get('fc.settings', {}) };
let todos = store.get('fc.todos', []);
let timer = {
  mode: 'focus', running: false, endAt: null, remaining: null, completedFocus: 0, activeTaskId: null,
  ...store.get('fc.timer', {}),
};
if (typeof timer.remaining !== 'number') timer.remaining = durationOf(timer.mode);

let view = 'collapsed';
let editingId = null;

const saveSettings = () => store.set('fc.settings', settings);
const saveTodos = () => store.set('fc.todos', todos);
const saveTimer = () => store.set('fc.timer', timer);

/* ---------------- timer ---------------- */

function durationOf(mode) { return settings[mode] * 60000; }
function remainingMs() { return timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remaining; }
function isFresh() { return !timer.running && timer.remaining === durationOf(timer.mode); }
function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function start() {
  if (timer.running) return;
  if (timer.remaining <= 0) timer.remaining = durationOf(timer.mode);
  timer.running = true;
  timer.endAt = Date.now() + timer.remaining;
  saveTimer();
  render();
}

function pause() {
  if (!timer.running) return;
  timer.remaining = remainingMs();
  timer.running = false;
  timer.endAt = null;
  saveTimer();
  render();
}

function toggleTimer() { timer.running ? pause() : start(); }

function resetTimer() {
  timer.running = false;
  timer.endAt = null;
  timer.remaining = durationOf(timer.mode);
  saveTimer();
  render();
}

function setTimerMode(mode) {
  timer.mode = mode;
  resetTimer();
}

function nextModeAfter(finished, counted) {
  if (finished !== 'focus') return 'focus';
  return counted && timer.completedFocus % settings.longEvery === 0 ? 'long' : 'short';
}

function skip() {
  setTimerMode(nextModeAfter(timer.mode, false));
}

function complete({ quiet = false } = {}) {
  const finished = timer.mode;
  if (finished === 'focus') {
    timer.completedFocus += 1;
    const task = todos.find((t) => t.id === timer.activeTaskId);
    if (task) { task.poms = (task.poms || 0) + 1; saveTodos(); }
  }
  const next = nextModeAfter(finished, true);
  timer.mode = next;
  timer.running = false;
  timer.endAt = null;
  timer.remaining = durationOf(next);
  saveTimer();
  if (!quiet) {
    announce(finished, next);
    if (finished === 'focus' && settings.autoStartBreaks) start();
  }
  render();
}

/* ---------------- alerts ---------------- */

let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new AudioContext();
    const now = audioCtx.currentTime;
    [[659, 0], [880, 0.18], [1319, 0.36]].forEach(([freq, t]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.16, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.7);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.75);
    });
  } catch { /* audio unavailable */ }
}

function announce(finished, next) {
  if (settings.sound) chime();
  const title = finished === 'focus' ? 'Focus session complete' : 'Break is over';
  const body = finished === 'focus'
    ? `Nice work. Time for a ${settings[next]}-minute ${next === 'long' ? 'long ' : ''}break.`
    : 'Ready for the next focus session?';
  try { new Notification(title, { body, silent: true }); } catch { /* notifications blocked */ }
  $$('.collapsed-view').forEach((el) => {
    el.classList.remove('ding');
    void el.offsetWidth; // restart the animation
    el.classList.add('ding');
    setTimeout(() => el.classList.remove('ding'), 5000);
  });
}

/* ---------------- to-dos ---------------- */

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const undoneCount = () => todos.filter((t) => !t.done).length;
function nextTask() {
  return todos.find((t) => t.id === timer.activeTaskId && !t.done) || todos.find((t) => !t.done) || null;
}

function addTask(text) {
  todos.push({ id: uid(), text, done: false, poms: 0, createdAt: Date.now() });
  saveTodos();
  render();
}

function toggleTask(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  if (t.done && timer.activeTaskId === id) { timer.activeTaskId = null; saveTimer(); }
  saveTodos();
  render();
}

function removeTask(id) {
  todos = todos.filter((t) => t.id !== id);
  if (timer.activeTaskId === id) { timer.activeTaskId = null; saveTimer(); }
  saveTodos();
  render();
}

function focusOnTask(id) {
  if (timer.activeTaskId === id && timer.mode === 'focus') { toggleTimer(); return; }
  timer.activeTaskId = id;
  if (timer.mode !== 'focus') setTimerMode('focus');
  saveTimer();
  start();
  render();
}

function clearDone() {
  const removed = new Set(todos.filter((t) => t.done).map((t) => t.id));
  todos = todos.filter((t) => !t.done);
  if (removed.has(timer.activeTaskId)) { timer.activeTaskId = null; saveTimer(); }
  saveTodos();
  render();
}

function startEditing(li, id) {
  const t = todos.find((x) => x.id === id);
  const span = $('.text', li);
  if (!t || t.done || !span) return;
  editingId = id;
  span.contentEditable = 'true';
  span.focus();
  document.getSelection().selectAllChildren(span);

  const finish = (save) => {
    span.removeEventListener('keydown', onKey);
    span.removeEventListener('blur', onBlur);
    const text = span.textContent.replace(/\s+/g, ' ').trim();
    if (save && text) { t.text = text.slice(0, 200); saveTodos(); }
    editingId = null;
    render();
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  };
  const onBlur = () => finish(true);
  span.addEventListener('keydown', onKey);
  span.addEventListener('blur', onBlur);
}

/* ---------------- views ---------------- */

function expand() {
  if (view === 'expanded') return;
  view = 'expanded';
  api.setMode('expanded');
  render();
  requestAnimationFrame(() => $('#add-input').focus());
}

function collapse() {
  closeSettings();
  if (view === 'collapsed') return;
  view = 'collapsed';
  render();
  api.setMode(settings.collapsedStyle);
}

function hideWidget() {
  collapse();
  api.hide();
}

function openSettings() {
  for (const el of $$('#settings [data-setting]')) {
    const v = settings[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
  for (const r of $$('#settings input[name="collapsedStyle"]')) r.checked = r.value === settings.collapsedStyle;
  $('#settings').classList.add('open');
  $('#settings').setAttribute('aria-hidden', 'false');
  $('#settings-back').focus();
}

function closeSettings() {
  $('#settings').classList.remove('open');
  $('#settings').setAttribute('aria-hidden', 'true');
}

/* ---------------- rendering ---------------- */

const ICONS = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function render() {
  const b = document.body;
  b.dataset.view = view;
  b.dataset.style = settings.collapsedStyle;
  b.dataset.timer = timer.mode;
  b.classList.toggle('fade-idle', settings.fadeIdle);
  b.classList.toggle('running', timer.running);
  renderTimerControls();
  if (!editingId) renderTodos();
  renderTime();
}

function renderTimerControls() {
  for (const btn of $$('.modes button')) btn.setAttribute('aria-selected', String(btn.dataset.m === timer.mode));
  $('#t-toggle').textContent = timer.running ? 'Pause' : isFresh() ? 'Start' : 'Resume';
  $('#pill-toggle').setAttribute('aria-label', timer.running ? 'Pause timer' : 'Start timer');

  const dots = $('#sessions');
  dots.textContent = '';
  const inCycle = timer.completedFocus % settings.longEvery;
  const filled = inCycle === 0 && timer.completedFocus > 0 && timer.mode === 'long' ? settings.longEvery : inCycle;
  for (let i = 0; i < settings.longEvery; i++) {
    const dot = document.createElement('i');
    if (i < filled) dot.className = 'on';
    dots.append(dot);
  }

  const focusOn = $('#focus-on');
  const active = todos.find((t) => t.id === timer.activeTaskId && !t.done);
  focusOn.textContent = '';
  if (timer.mode !== 'focus') {
    focusOn.textContent = timer.mode === 'long' ? 'Long break — stretch, walk, hydrate.' : 'Short break — look away from the screen.';
  } else if (active) {
    focusOn.append('Working on ');
    const bold = document.createElement('b');
    bold.textContent = active.text;
    focusOn.append(bold);
  } else {
    focusOn.textContent = todos.some((t) => !t.done) ? 'Tip: press ▶ on a task to focus on it' : 'Add a task below, then press Start';
  }
}

function renderTodos() {
  const list = $('#list');
  list.textContent = '';
  const ordered = [...todos.filter((t) => !t.done), ...todos.filter((t) => t.done)];

  if (!ordered.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing here yet. Add your first task above.';
    list.append(li);
  }

  for (const t of ordered) {
    const li = document.createElement('li');
    li.className = 'task' + (t.done ? ' done' : '') + (t.id === timer.activeTaskId ? ' active' : '');
    li.dataset.id = t.id;

    const check = document.createElement('button');
    check.className = 'check';
    check.dataset.act = 'toggle';
    check.setAttribute('aria-label', t.done ? 'Mark as not done' : 'Mark as done');
    check.innerHTML = ICONS.check;

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = t.text;
    text.title = t.done ? '' : 'Double-click to edit';

    li.append(check, text);

    if (t.poms) {
      const poms = document.createElement('span');
      poms.className = 'poms';
      poms.textContent = t.poms;
      poms.title = `${t.poms} focus session${t.poms === 1 ? '' : 's'}`;
      li.append(poms);
    }

    if (!t.done) {
      const isRunningHere = t.id === timer.activeTaskId && timer.running && timer.mode === 'focus';
      const play = document.createElement('button');
      play.className = 'row-btn play';
      play.dataset.act = 'focus';
      play.setAttribute('aria-label', isRunningHere ? 'Pause' : 'Focus on this task');
      play.title = isRunningHere ? 'Pause' : 'Focus on this';
      play.innerHTML = isRunningHere ? ICONS.pause : ICONS.play;
      li.append(play);
    }

    const del = document.createElement('button');
    del.className = 'row-btn del';
    del.dataset.act = 'delete';
    del.setAttribute('aria-label', 'Delete task');
    del.title = 'Delete';
    del.innerHTML = ICONS.del;
    li.append(del);

    list.append(li);
  }

  const left = undoneCount();
  const done = todos.length - left;
  $('#count').textContent = todos.length ? `${left} left · ${done} done` : '';
  $('#clear-done').hidden = done === 0;
}

let lastStatusKey = '';
function renderTime() {
  const rem = remainingMs();
  const total = durationOf(timer.mode);
  const progress = total ? 1 - rem / total : 0;
  const label = fmt(rem);
  const fresh = isFresh();
  const left = undoneCount();
  const task = nextTask();

  $('#clock').textContent = label;
  for (const ring of $$('.ring-fill')) ring.style.strokeDashoffset = String(RING_C * (1 - progress));
  document.title = timer.running ? `${label} · Focus Corner` : 'Focus Corner';

  // Pill
  const top = $('#pill-top');
  top.textContent = '';
  if (fresh) {
    top.textContent = left ? `${left} to do` : 'All clear';
  } else {
    top.append(label + ' ');
    const m = document.createElement('span');
    m.className = 'mode';
    m.textContent = timer.running ? `· ${MODE_LABEL[timer.mode]}` : '· Paused';
    top.append(m);
  }
  $('#pill-sub').textContent = task ? task.text : todos.length ? 'Everything is done — nice!' : 'Click to add a task';

  // Bubble
  const mins = Math.ceil(rem / 60000);
  $('#bubble-num').textContent = fresh ? (left || '✓') : mins;
  $('#bubble-unit').textContent = fresh ? (left ? 'to do' : 'done') : 'min';

  // Edge tab
  $('#tab-label').textContent = fresh ? `${left} to do` : `${mins}m`;
  $('#tab-bar-fill').style.height = `${Math.round(progress * 100)}%`;

  // Tray / menu bar
  const status = { running: timer.running, label, modeLabel: MODE_LABEL[timer.mode] };
  const key = JSON.stringify(status);
  if (key !== lastStatusKey) { lastStatusKey = key; api.reportStatus(status); }
}

/* ---------------- events ---------------- */

for (const id of ['pill', 'bubble', 'tab']) {
  const el = document.getElementById(id);
  el.addEventListener('click', (e) => { if (!e.target.closest('.ring-btn')) expand(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); } });
}
$('#pill-toggle').addEventListener('click', (e) => { e.stopPropagation(); toggleTimer(); });

$('#btn-collapse').addEventListener('click', collapse);
$('#btn-hide').addEventListener('click', hideWidget);
$('#btn-settings').addEventListener('click', openSettings);
$('#settings-back').addEventListener('click', closeSettings);
$('#quit').addEventListener('click', () => api.quit());

$('#t-toggle').addEventListener('click', toggleTimer);
$('#t-reset').addEventListener('click', resetTimer);
$('#t-skip').addEventListener('click', skip);
$$('.modes button').forEach((btn) => btn.addEventListener('click', () => setTimerMode(btn.dataset.m)));

$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#add-input');
  const text = input.value.replace(/\s+/g, ' ').trim();
  if (!text) return;
  addTask(text);
  input.value = '';
  const list = $('#list');
  list.scrollTop = list.scrollHeight;
});

$('#list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  const li = e.target.closest('li.task');
  if (!btn || !li) return;
  const id = li.dataset.id;
  if (btn.dataset.act === 'toggle') toggleTask(id);
  if (btn.dataset.act === 'focus') focusOnTask(id);
  if (btn.dataset.act === 'delete') removeTask(id);
});
$('#list').addEventListener('dblclick', (e) => {
  const li = e.target.closest('li.task');
  if (li && e.target.closest('.text')) startEditing(li, li.dataset.id);
});

$('#settings').addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'launchAtLogin') { api.setLaunchAtLogin(el.checked); return; }
  const key = el.name || el.dataset.setting;
  if (!key) return;

  if (el.type === 'checkbox') {
    settings[key] = el.checked;
    if (key === 'alwaysOnTop') api.setAlwaysOnTop(el.checked);
  } else if (el.type === 'number') {
    let v = Math.round(Number(el.value));
    if (!Number.isFinite(v)) v = DEFAULTS[key];
    v = Math.min(Number(el.max), Math.max(Number(el.min), v));
    el.value = v;
    const wasFresh = isFresh();
    settings[key] = v;
    if (wasFresh) { timer.remaining = durationOf(timer.mode); saveTimer(); }
  } else {
    settings[key] = el.value;
  }
  saveSettings();
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || editingId) return;
  if ($('#settings').classList.contains('open')) closeSettings();
  else if (view === 'expanded') collapse();
});

api.onCommand((cmd) => {
  if (cmd === 'toggle-timer') toggleTimer();
  if (cmd === 'expand') expand();
  if (cmd === 'collapse') collapse();
});

api.onBlur(() => {
  if (view === 'expanded' && settings.autoCollapse && !editingId && !$('#settings').classList.contains('open')) collapse();
});

/* ---------------- start up ---------------- */

const isMac = api.platform === 'darwin';
$('#shortcut').innerHTML = isMac
  ? '<kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>Space</kbd>'
  : '<kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Space</kbd>';
if (api.platform === 'linux') $('#login-row').hidden = true;
api.getLaunchAtLogin().then((on) => { $('#launchAtLogin').checked = !!on; }).catch(() => {});

// A session that ended while the app was closed rolls over quietly.
if (timer.running && timer.endAt <= Date.now()) complete({ quiet: true });

api.setAlwaysOnTop(settings.alwaysOnTop);
render();
api.setMode(settings.collapsedStyle);

setInterval(() => {
  if (timer.running && Date.now() >= timer.endAt) complete();
  else renderTime();
}, 250);

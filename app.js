const KEY = 'notes.v1';
const $ = (id) => document.getElementById(id);
const phone = matchMedia('(max-width: 700px)');

let notes = load();
let currentId = null;
let query = '';
let deleted = null;
let toastTimer = null;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch {}
}
// Local edit: save and queue a sync.
function changed() {
  save();
  Sync.soon();
}

// Deleted notes stay in the array (flagged) so the delete can sync.
const live = () => notes.filter((n) => !n.deleted);
const current = () => live().find((n) => n.id === currentId);
const lines = (n) => n.text.split('\n').map((l) => l.trim()).filter(Boolean);
const titleOf = (n) => lines(n)[0] || 'New note';
const previewOf = (n) => lines(n)[1] || '';

function when(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

function sorted() {
  const q = query.toLowerCase();
  return live()
    .filter((n) => !q || n.text.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
}

function renderList() {
  const list = $('list');
  list.replaceChildren();
  const items = sorted();
  for (const n of items) {
    const li = document.createElement('li');
    li.dataset.id = n.id;
    if (n.id === currentId) li.className = 'selected';
    const title = document.createElement('div');
    title.className = 'title';
    if (n.pinned) {
      const dot = document.createElement('span');
      dot.className = 'pin-dot';
      title.append(dot);
    }
    title.append(titleOf(n));
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `${when(n.updated)}  ${previewOf(n)}`;
    li.append(title, sub);
    list.append(li);
  }
  $('empty').hidden = items.length > 0;
  $('empty').textContent = query ? 'No matches' : 'No notes yet';
}

function renderEditor() {
  const n = current();
  document.body.classList.toggle('no-note', !n);
  if (!n) return;
  if ($('text').value !== n.text) $('text').value = n.text;
  $('meta').textContent = `${when(n.updated)} · ${countWords(n.text)} words`;
  $('pin').classList.toggle('on', !!n.pinned);
}

const countWords = (t) => (t.match(/\S+/g) || []).length;

function open(id, { focus = false } = {}) {
  dropIfEmpty(id);
  currentId = id;
  document.body.classList.toggle('editing', !!id);
  renderList();
  renderEditor();
  if (focus) $('text').focus();
}

// Leaving a blank note removes it, so "New" never leaves clutter behind.
function dropIfEmpty(nextId) {
  const n = current();
  if (n && n.id !== nextId && !n.text.trim()) remove(n);
}

function newNote() {
  const now = Date.now();
  const n = { id: crypto.randomUUID(), text: '', created: now, updated: now, pinned: false, deleted: false };
  notes.push(n);
  query = '';
  $('search').value = '';
  open(n.id, { focus: true });
}

function remove(n) {
  n.deleted = true;
  n.updated = Date.now();
  changed();
}

function back() {
  open(null);
}

function deleteCurrent() {
  const n = current();
  if (!n) return;
  remove(n);
  deleted = n;
  const next = phone.matches ? null : sorted()[0]?.id ?? null;
  currentId = null;
  open(next);
  if (n.text.trim()) showToast();
}

function showToast() {
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; deleted = null; }, 5000);
}

function undo() {
  if (!deleted) return;
  deleted.deleted = false;
  deleted.updated = Date.now();
  changed();
  const id = deleted.id;
  deleted = null;
  $('toast').hidden = true;
  open(id);
}

// Events
$('text').addEventListener('input', (e) => {
  const n = current();
  if (!n) return;
  n.text = e.target.value;
  n.updated = Date.now();
  changed();
  renderList();
  renderEditor();
});

$('list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) open(li.dataset.id);
});

$('search').addEventListener('input', (e) => {
  query = e.target.value;
  renderList();
});

$('new').addEventListener('click', newNote);
$('back').addEventListener('click', back);
$('delete').addEventListener('click', deleteCurrent);
$('undo').addEventListener('click', undo);
$('pin').addEventListener('click', () => {
  const n = current();
  if (!n) return;
  n.pinned = !n.pinned;
  n.updated = Date.now();
  changed();
  renderList();
  renderEditor();
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (phone.matches) back();
    $('search').focus();
    $('search').select();
  } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    newNote();
  } else if (e.key === 'Escape' && document.activeElement === $('text') && phone.matches) {
    back();
  }
});

// Keep other open tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  notes = load();
  closeIfGone();
  renderList();
  renderEditor();
});

// Cloud sync
function closeIfGone() {
  if (currentId && !current()) {
    currentId = null;
    document.body.classList.remove('editing');
  }
}

Sync.init({
  getNotes: () => notes,
  merge(incoming) {
    for (const r of incoming) {
      const i = notes.findIndex((n) => n.id === r.id);
      if (i === -1) notes.push(r);
      else if (r.updated > notes[i].updated) notes[i] = r;
    }
    save();
    closeIfGone();
    renderList();
    renderEditor();
  },
  onStatus(state) {
    $('cloud').hidden = state === 'off';
    $('cloud').dataset.state = state;
    $('cloud').title = {
      'signed-out': 'Turn on sync', idle: 'Synced', syncing: 'Syncing…', error: 'Sync problem — tap for details',
    }[state] || '';
    renderAccount();
  },
});

function renderAccount() {
  const email = Sync.email();
  $('signed-in').hidden = !email;
  $('auth-form').hidden = !!email;
  $('auth-msg').hidden = !!email;
  $('who').textContent = email ? `Signed in as ${email}. Your notes sync automatically.` : '';
}

function authMessage(text) {
  $('auth-msg').textContent = text;
}

$('cloud').addEventListener('click', () => {
  authMessage($('cloud').dataset.state === 'error'
    ? 'Last sync failed. It retries automatically when you are back online.'
    : 'Sign in to keep your notes in sync on all your devices.');
  renderAccount();
  $('account').showModal();
});
$('account-done').addEventListener('click', () => $('account').close());
$('account').addEventListener('click', (e) => { if (e.target === $('account')) $('account').close(); });

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const creating = e.submitter?.id === 'signup';
  const email = $('email').value.trim();
  const password = $('password').value;
  authMessage(creating ? 'Creating account…' : 'Signing in…');
  try {
    if (creating) {
      const confirm = await Sync.signUp(email, password);
      authMessage(confirm ? 'Check your email to confirm, then sign in here.' : 'Account created. Syncing…');
    } else {
      await Sync.signIn(email, password);
      $('password').value = '';
      authMessage('Signed in. Syncing…');
    }
  } catch (err) {
    authMessage(err.message || 'Something went wrong.');
  }
});

$('signout').addEventListener('click', async () => {
  await Sync.signOut();
  authMessage('Signed out. Your notes stay on this device.');
});

// Start: on a computer open the latest note; on a phone show the list.
open(phone.matches ? null : sorted()[0]?.id ?? null);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

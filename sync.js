// Cloud sync through Supabase. Stays off until config.js has a URL and key.
// Merge rule: for each note, whichever copy was edited last wins.
const Sync = (() => {
  const cfg = window.NOTES_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const db = enabled ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  let user = null;
  let busy = false;
  let again = false;
  let timer = null;
  let hooks = { getNotes: () => [], merge: () => {}, onStatus: () => {} };

  const status = () => (!enabled ? 'off' : user ? 'idle' : 'signed-out');

  async function init(h) {
    hooks = h;
    if (!enabled) return hooks.onStatus('off');
    const { data } = await db.auth.getSession();
    user = data.session?.user ?? null;
    hooks.onStatus(status());
    db.auth.onAuthStateChange((_event, session) => {
      const before = user?.id;
      user = session?.user ?? null;
      hooks.onStatus(status());
      if (user && user.id !== before) now();
    });
    if (user) now();
    addEventListener('online', now);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) now(); });
    setInterval(() => { if (!document.hidden) now(); }, 30000);
  }

  function soon() {
    clearTimeout(timer);
    timer = setTimeout(now, 1500);
  }

  async function now() {
    if (!user || !navigator.onLine) return;
    if (busy) { again = true; return; }
    busy = true;
    hooks.onStatus('syncing');
    try {
      const { data: rows, error } = await db
        .from('notes')
        .select('id, text, pinned, created, updated, deleted');
      if (error) throw error;

      const remote = new Map(rows.map((r) => [r.id, { ...r, created: +r.created, updated: +r.updated }]));
      const local = new Map(hooks.getNotes().map((n) => [n.id, n]));

      // Pull: take remote copies that are newer than ours.
      const incoming = [...remote.values()].filter((r) => !local.has(r.id) || r.updated > local.get(r.id).updated);
      if (incoming.length) hooks.merge(incoming);

      // Push: send our copies that are newer than the server's.
      const outgoing = hooks.getNotes()
        .filter((n) => !remote.has(n.id) || n.updated > remote.get(n.id).updated)
        .map(({ id, text, pinned, created, updated, deleted }) => ({
          id, text, created, updated, pinned: !!pinned, deleted: !!deleted,
        }));
      if (outgoing.length) {
        const { error: pushError } = await db.from('notes').upsert(outgoing);
        if (pushError) throw pushError;
      }
      hooks.onStatus('idle');
    } catch (err) {
      console.warn('Sync failed:', err);
      hooks.onStatus('error');
    } finally {
      busy = false;
      if (again) { again = false; now(); }
    }
  }

  async function signIn(email, password) {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  // Returns true when Supabase wants the email confirmed before signing in.
  async function signUp(email, password) {
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) throw error;
    return !data.session;
  }

  async function signOut() {
    await db.auth.signOut();
  }

  return { enabled, init, soon, now, signIn, signUp, signOut, email: () => user?.email ?? '' };
})();

/* 聽道 — session archive: pure helpers (search / export / import / markdown) + IndexedDB store (UMD). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./refs.js'));
  else root.TingdaoArchive = factory(root.TingdaoRefs);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';
  const SCHEMA = 'tingdao.archive.v1';

  const pad = (n) => String(n).padStart(2, '0');
  function localDate(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function localDateTime(ts) { const d = new Date(ts); return `${localDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function newSession(now) {
    now = now || Date.now();
    return { id: uid(), title: '', speaker: '', date: now, updated: now, transcript: '', segments: [], refs: [], hints: [], warnings: [], summary: null, llmSummary: null, notes: '' };
  }

  /* ---- ref overlap: does stored ref a overlap with searched ref b? ---- */
  function range(ref) {
    if (ref.whole) return { c1: ref.chapter, c2: ref.chapter, whole: true };
    return { c1: ref.chapter, c2: ref.endChapter || ref.chapter, whole: false };
  }
  function refOverlap(a, b) {
    if (!a || !b || a.bookId !== b.bookId) return false;
    const ra = range(a), rb = range(b);
    if (ra.c2 < rb.c1 || rb.c2 < ra.c1) return false;
    if (ra.whole || rb.whole) return true;
    if (ra.c1 !== ra.c2 || rb.c1 !== rb.c2) return true; // multi-chapter: be lenient
    if (a.chapter !== b.chapter) return false;
    for (const [s1, e1] of a.segments) for (const [s2, e2] of b.segments) if (s1 <= e2 && s2 <= e1) return true;
    return false;
  }

  function bookMatches(q, bookId) {
    q = q.trim(); if (!q) return true;
    const b = R.BOOKS[bookId - 1]; if (!b) return false;
    if (b.name.includes(q) || (b.abbr && b.abbr === q)) return true;
    return (b.aliases || []).some((x) => x === q || x.includes(q));
  }

  function haystack(s) {
    return [s.title, s.speaker, s.notes, s.transcript, s.summary && s.summary.points && s.summary.points.join(' '), s.llmSummary && s.llmSummary.text, (s.warnings || []).map((w) => w.title).join(' '), (s.refs || []).map((r) => r.label).join(' ')].filter(Boolean).join('\n');
  }

  /** filters: {q, verse, book, from, to} (dates 'YYYY-MM-DD', local). All provided filters must match. */
  function search(list, f) {
    f = f || {};
    const terms = (f.q || '').split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
    let vref = null;
    if (f.verse && f.verse.trim()) {
      vref = R.lookup(f.verse.trim(), null);
      if (!vref) return [];
    }
    const out = list.filter((s) => {
      if (terms.length) { const h = haystack(s).toLowerCase(); if (!terms.every((t) => h.includes(t))) return false; }
      if (vref && !(s.refs || []).some((r) => refOverlap(r, vref))) return false;
      if (f.book && f.book.trim() && !(s.refs || []).some((r) => bookMatches(f.book, r.bookId))) return false;
      const d = localDate(s.date);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      return true;
    });
    return out.sort((a, b) => b.date - a.date);
  }

  /** Short snippet of transcript around first term hit. */
  function snippet(s, q, len) {
    len = len || 60;
    const t = (s.transcript || '').replace(/\s+/g, ' ');
    const term = (q || '').split(/\s+/).filter(Boolean)[0];
    if (!term) return t.slice(0, len);
    const i = t.toLowerCase().indexOf(term.toLowerCase());
    if (i < 0) return t.slice(0, len);
    const a = Math.max(0, i - 20);
    return (a > 0 ? '…' : '') + t.slice(a, a + len);
  }

  /* ---- Markdown ---- */
  function toMarkdown(s, opts) {
    opts = opts || {};
    const L = [];
    L.push(`# ${s.title || '未命名講道'}`);
    L.push('');
    L.push(`- 日期：${localDateTime(s.date)}`);
    if (s.speaker) L.push(`- 講員：${s.speaker}`);
    const sm = s.summary;
    if (s.refs && s.refs.length) L.push(`- 提到的經文：${s.refs.map((r) => r.label).join('、')}`);
    if (sm && sm.themes && sm.themes.length) L.push(`- 主題：${sm.themes.join('、')}`);
    L.push('');
    if (s.llmSummary && s.llmSummary.text) { L.push('## AI 摘要'); L.push(''); L.push(s.llmSummary.text.trim()); L.push(''); }
    if (sm && sm.points && sm.points.length) { L.push('## 重點（自動摘錄）'); L.push(''); sm.points.forEach((p, i) => L.push(`${i + 1}. ${p}`)); L.push(''); }
    if (s.hints && s.hints.length) {
      L.push('## 相關經文提示'); L.push('');
      for (const h of s.hints) L.push(`- ${h.label}${h.kind === 'quote' ? '（引用）' : h.kind === 'theme' ? `（主題：${h.theme || ''}）` : ''}${h.heard ? `：「${h.heard}」` : ''}`);
      L.push('');
    }
    if (s.warnings && s.warnings.length) {
      L.push('## 需要斟酌的說法'); L.push('');
      for (const w of s.warnings) {
        L.push(`### ${w.title}（把握度：${w.conf >= 0.75 ? '高' : w.conf >= 0.55 ? '中' : '低'}）`);
        if (w.heard) L.push(`> 聽到：${w.heard}`);
        L.push(''); L.push(w.why || '');
        if (w.verses && w.verses.length) L.push(`\n對照經文：${w.verses.join('、')}`);
        if (w.correct) L.push(`\n正確／參考：${w.correct}`);
        L.push('');
      }
    }
    if (opts.transcript !== false) { L.push('## 逐字稿'); L.push(''); L.push(s.transcript || ''); L.push(''); }
    L.push('---'); L.push('由「聽道」自動整理；提示與警示僅供參考，請以聖經與牧者教導為準。');
    return L.join('\n');
  }

  /* ---- JSON export / import ---- */
  function exportJSON(list) { return JSON.stringify({ schema: SCHEMA, exported: Date.now(), sessions: list }, null, 1); }

  function sanitize(s) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.id !== 'string' || !s.id) return null;
    const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
    const arr = (x) => (Array.isArray(x) ? x : []);
    const out = {
      id: s.id, title: String(s.title || ''), speaker: String(s.speaker || ''), date: num(s.date, Date.now()), updated: num(s.updated, num(s.date, Date.now())),
      transcript: String(s.transcript || ''), segments: arr(s.segments), refs: arr(s.refs).filter((r) => r && typeof r.bookId === 'number'), hints: arr(s.hints), warnings: arr(s.warnings),
      summary: s.summary && typeof s.summary === 'object' ? s.summary : null, llmSummary: s.llmSummary && typeof s.llmSummary === 'object' ? s.llmSummary : null, notes: String(s.notes || ''),
    };
    return out;
  }

  /** returns {sessions, skipped} or throws Error with zh message */
  function parseImport(text) {
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('檔案不是有效的 JSON'); }
    const list = Array.isArray(j) ? j : j && Array.isArray(j.sessions) ? j.sessions : null;
    if (!list) throw new Error('找不到講道紀錄（格式不符）');
    const sessions = [], skipped = [];
    for (const s of list) { const c = sanitize(s); if (c) sessions.push(c); else skipped.push(s); }
    return { sessions, skipped: skipped.length };
  }

  /** merge incoming into existing by id; newer `updated` wins. Returns {merged, added, updated, kept}. */
  function merge(existing, incoming) {
    const map = new Map(existing.map((s) => [s.id, s]));
    let added = 0, updated = 0, kept = 0;
    for (const s of incoming) {
      const cur = map.get(s.id);
      if (!cur) { map.set(s.id, s); added++; } else if ((s.updated || 0) > (cur.updated || 0)) { map.set(s.id, s); updated++; } else kept++;
    }
    return { merged: [...map.values()].sort((a, b) => b.date - a.date), added, updated, kept };
  }

  /* ---- stores ---- */
  function memoryStore() {
    const m = new Map();
    return {
      kind: 'memory',
      async put(s) { m.set(s.id, JSON.parse(JSON.stringify(s))); },
      async get(id) { const s = m.get(id); return s ? JSON.parse(JSON.stringify(s)) : null; },
      async all() { return [...m.values()].map((s) => JSON.parse(JSON.stringify(s))).sort((a, b) => b.date - a.date); },
      async del(id) { m.delete(id); },
      async clear() { m.clear(); },
    };
  }

  function idbStore(idb, name) {
    name = name || 'tingdao';
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        const rq = idb.open(name, 1);
        rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('sessions')) { const os = db.createObjectStore('sessions', { keyPath: 'id' }); os.createIndex('date', 'date'); } };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
      return dbp;
    }
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('sessions', mode), os = t.objectStore('sessions');
        const rq = fn(os);
        t.oncomplete = () => res(rq && rq.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    };
    return {
      kind: 'indexeddb',
      put: (s) => tx('readwrite', (os) => os.put(s)),
      get: (id) => tx('readonly', (os) => os.get(id)).then((x) => x || null),
      all: () => tx('readonly', (os) => os.getAll()).then((l) => (l || []).sort((a, b) => b.date - a.date)),
      del: (id) => tx('readwrite', (os) => os.delete(id)),
      clear: () => tx('readwrite', (os) => os.clear()),
    };
  }

  function defaultStore() {
    try { if (typeof indexedDB !== 'undefined' && indexedDB) return idbStore(indexedDB); } catch (e) { /* fall through */ }
    return memoryStore();
  }

  return { SCHEMA, newSession, search, snippet, toMarkdown, exportJSON, parseImport, merge, sanitize, refOverlap, memoryStore, idbStore, defaultStore, localDate, localDateTime };
});

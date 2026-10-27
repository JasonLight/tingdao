/* 聽道 — local verse index: recognise quoted / near-quoted / alluded verses with no reference spoken. UMD, offline, no key.
   Method: char-bigram inverted index (IDF weighted) over the bundled CUV -> top candidates -> semi-global edit-distance
   alignment of verse (and its clauses) against the transcript window -> classify (quote / near / allusion). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TingdaoVerses = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VARIANT = { 裏: '裡', 着: '著', 她: '他', 祂: '他', 衪: '他', 妳: '你', 爲: '為', 纔: '才', 衆: '眾', 羣: '群', 峯: '峰', 吿: '告', 致: '至', 帝: '神', 麽: '麼' };
  const KEEP = /[\u3400-\u9fff\uf900-\ufaff0-9a-zA-Z]/;
  // chars that carry little meaning: differences made only of these are not "meaningful"
  const FUNC = new Set('的了是在也就都和與及而但則之於以其這那個把被讓叫使將所已又還才只更很最會能可要啊呀吧呢嗎哦喔哪阿喔嗯'.split(''));
  const NEG = new Set('不沒無非未莫勿別弗'.split(''));

  /** Normalise for matching. Returns {s, map} where map[i] = index in the original string. 上帝→神 (one char). */
  function norm(str) {
    let s = '', map = [];
    for (let i = 0; i < str.length; i++) {
      let ch = str[i];
      if (!KEEP.test(ch)) continue;
      if (ch === '上' && str[i + 1] === '帝') { s += '神'; map.push(i); i++; continue; }
      if (VARIANT[ch]) ch = VARIANT[ch];
      s += ch; map.push(i);
    }
    return { s, map };
  }

  /** Build the index. bible = parsed cuv.json. */
  function buildIndex(bible) {
    const vs = [];            // {b,c,v,n,t}
    const post = new Map();   // bigram -> [verse id]
    for (let b = 0; b < bible.b.length; b++) {
      const bk = bible.b[b];
      for (let c = 0; c < bk.length; c++) {
        const ch = bk[c];
        for (let v = 0; v < ch.length; v++) {
          const t = ch[v];
          if (!t) continue;
          const n = norm(t).s;
          if (n.length < 4) continue;
          const id = vs.length;
          vs.push({ b: b + 1, c: c + 1, v: v + 1, n, t });
          const seen = new Set();
          for (let i = 0; i + 1 < n.length; i++) {
            const g = n.substr(i, 2);
            if (seen.has(g)) continue;
            seen.add(g);
            let l = post.get(g);
            if (!l) post.set(g, (l = []));
            l.push(id);
          }
        }
      }
    }
    const N = vs.length;
    return { bible, vs, post, N, byKey: null };
  }
  function verseId(idx, b, c, v) {
    if (!idx.byKey) { idx.byKey = new Map(); idx.vs.forEach((x, i) => idx.byKey.set(x.b * 1e6 + x.c * 1e3 + x.v, i)); }
    const id = idx.byKey.get(b * 1e6 + c * 1e3 + v);
    return id == null ? -1 : id;
  }
  const idf = (idx, g) => { const l = idx.post.get(g); return l ? Math.log(1 + idx.N / l.length) : 0; };

  /** Top-k candidate verse ids for a normalised query string. */
  function candidates(idx, q, k) {
    const sc = new Map();
    const seen = new Set();
    for (let i = 0; i + 1 < q.length; i++) {
      const g = q.substr(i, 2);
      if (seen.has(g)) continue;
      seen.add(g);
      const l = idx.post.get(g);
      if (!l || l.length > 600) continue;
      const w = Math.log(1 + idx.N / l.length);
      for (const id of l) sc.set(id, (sc.get(id) || 0) + w);
    }
    const arr = [];
    for (const [id, s] of sc) {
      const n = idx.vs[id].n;
      // coverage-normalised: how much of the verse's (rarity weighted) mass is present in the query
      arr.push([id, s / Math.sqrt(Math.max(8, n.length))]);
    }
    arr.sort((a, b) => b[1] - a[1]);
    return arr.slice(0, k).map((x) => x[0]);
  }

  /** Semi-global alignment: best substring of T for pattern P (edit distance). Returns {dist, start, end, ops}. */
  function fuzzyFind(P, T) {
    const m = P.length, n = T.length;
    if (!m || !n) return { dist: m, start: 0, end: 0, ops: [] };
    const W = n + 1;
    const D = new Uint16Array((m + 1) * W);
    for (let i = 1; i <= m; i++) D[i * W] = i;
    for (let i = 1; i <= m; i++) {
      const pc = P.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const sub = D[(i - 1) * W + j - 1] + (pc === T.charCodeAt(j - 1) ? 0 : 1);
        const del = D[(i - 1) * W + j] + 1;      // char in pattern missing from text
        const ins = D[i * W + j - 1] + 1;        // extra char in text
        D[i * W + j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
      }
    }
    let best = 1e9, end = 0;
    for (let j = 1; j <= n; j++) if (D[m * W + j] < best) { best = D[m * W + j]; end = j; }
    // traceback
    const ops = []; // {t:'=' | 's' | 'd' | 'i', p: pattern char idx, x: text idx}
    let i = m, j = end;
    while (i > 0) {
      const cur = D[i * W + j];
      if (j > 0 && cur === D[(i - 1) * W + j - 1] + (P.charCodeAt(i - 1) === T.charCodeAt(j - 1) ? 0 : 1)) { ops.push({ t: P.charCodeAt(i - 1) === T.charCodeAt(j - 1) ? '=' : 's', p: i - 1, x: j - 1 }); i--; j--; }
      else if (cur === D[(i - 1) * W + j] + 1) { ops.push({ t: 'd', p: i - 1, x: j }); i--; }
      else if (j > 0) { ops.push({ t: 'i', p: i, x: j - 1 }); j--; }
      else { ops.push({ t: 'd', p: i - 1, x: j }); i--; }
    }
    ops.reverse();
    return { dist: best, start: j, end, ops };
  }

  /** split a verse into clause units (original text), merging fragments < 6 normalised chars. */
  function clauses(text) {
    const parts = text.split(/[，；：。！？、,;:!?「」『』]/).map((x) => x.trim()).filter(Boolean);
    const out = []; let buf = '';
    for (const p of parts) {
      buf += p;
      if (norm(buf).s.length >= 6) { out.push(buf); buf = ''; }
    }
    if (buf && out.length) out[out.length - 1] += buf; else if (buf) out.push(buf);
    return out;
  }

  const FRAME = /經上(?:說|記著|寫著)|聖經(?:上|裡|中)?(?:說|記著|寫著|告訴我們)|神說|主說|耶穌說|保羅說|彼得說|約翰說|大衛說|先知說|記著說|寫著說|寫著|記著|經文說|聖經的話|神的話說|應許說|主耶穌說|使徒說|他說|祂說/;

  function occurrences(idx, unitN, cap) {
    // number of verses (up to cap) whose normalised text contains unitN
    let rare = null, rl = 1e9;
    for (let i = 0; i + 1 < unitN.length; i++) { const l = idx.post.get(unitN.substr(i, 2)); if (!l) return 0; if (l.length < rl) { rl = l.length; rare = l; } }
    let c = 0;
    for (const id of rare || []) if (idx.vs[id].n.includes(unitN)) { if (++c >= cap) break; }
    return c;
  }

  /**
   * Analyse the newest transcript text against the index.
   * opts: { prev: preceding text (context window), refVerses: [[b,c,v]...] verses explicitly referenced nearby,
   *         skipIds: Set of verse ids not to report as hints }
   * Returns matches: {id,b,c,v,kind:'quote'|'near'|'allusion', sim, unit, heard, framed, diffs:[{from,to}], negation, alts}
   */
  function analyze(idx, text, opts) {
    opts = opts || {};
    const prev = (opts.prev || '').slice(-160);
    const full = prev + text;
    const nf = norm(full), nt = norm(text);
    const cutoff = nf.s.length - nt.s.length; // normalised index where new text starts
    if (nt.s.length < 7) return [];
    const win = nf.s.slice(-420), winOff = nf.s.length - win.length;
    const framed = FRAME.test(text);
    const out = [];
    const refIds = new Set();
    for (const r of opts.refVerses || []) { const id = verseId(idx, r[0], r[1], r[2]); if (id >= 0) refIds.add(id); }
    const cand = new Set(candidates(idx, win, 24));
    for (const id of refIds) cand.add(id);
    for (const id of cand) {
      const V = idx.vs[id];
      const isRef = refIds.has(id);
      const units = [{ txt: V.t, whole: true }].concat(clauses(V.t).map((c) => ({ txt: c, whole: false })));
      let best = null;
      for (const u of units) {
        const un = norm(u.txt).s;
        if (un.length < 7) continue;
        const f = fuzzyFind(un, win);
        // trim edges: unrecited head/tail of the verse (or stray text) is a partial quote, not a misquote
        let ops = f.ops.slice();
        while (ops.length && ops[0].t !== '=' && ops[0].t !== 's') ops.shift();
        while (ops.length && ops[ops.length - 1].t !== '=' && ops[ops.length - 1].t !== 's') ops.pop();
        if (!ops.length) continue;
        const coreLen = ops.filter((o) => o.t !== 'i').length;
        const coreDist = ops.filter((o) => o.t !== '=').length;
        const sim = 1 - coreDist / coreLen;
        const xs = ops.filter((o) => o.t !== 'd').map((o) => o.x);
        if (!xs.length) continue;
        const cs = Math.min(...xs), ce = Math.max(...xs) + 1;
        if (ce + winOff <= cutoff) continue;                  // match lies entirely in the context, not the new text
        const minSim = isRef ? 0.62 : 0.72;
        if (sim < minSim) continue;
        if (coreLen < 7 || (coreLen < 10 && sim < 0.95)) continue;
        const score = sim * sim * coreLen;
        if (!best || score > best.score) best = { u, un, f: { ops, start: cs, end: ce, dist: coreDist }, sim, score, coreLen };
      }
      if (!best) continue;
      const { u, un, f, sim } = best;
      const occ = occurrences(idx, norm(u.txt).s, 5);
      if (!isRef && occ >= 4) continue;                         // formulaic phrase found all over the Bible
      // heard text in original coordinates
      const a = f.start + winOff, bnd = f.end + winOff;
      const oStart = nf.map[a], oEnd = nf.map[Math.min(bnd, nf.map.length) - 1] + 1;
      const heard = full.slice(oStart, oEnd);
      // diffs
      const diffs = []; let negation = false, onlyFunc = true;
      let cur = null;
      const flush = () => { if (cur) { diffs.push({ from: cur.from, to: cur.to }); cur = null; } };
      for (const op of f.ops) {
        if (op.t === '=') { flush(); continue; }
        cur = cur || { from: '', to: '' };
        if (op.t === 's' || op.t === 'd') { const pc = un[op.p]; cur.to += pc; if (!FUNC.has(pc)) onlyFunc = false; if (NEG.has(pc)) negation = true; }
        if (op.t === 's' || op.t === 'i') { const tc = win[op.x]; cur.from += tc; if (!FUNC.has(tc)) onlyFunc = false; if (NEG.has(tc)) negation = true; }
      }
      flush();
      const effSim = onlyFunc && f.dist <= 3 ? Math.max(sim, 0.97) : sim;
      let kind;
      if (effSim >= 0.97) kind = 'quote';
      else if (effSim >= 0.72 && (framed || isRef)) kind = 'near';
      else if (effSim >= 0.72) kind = 'allusion';
      else kind = 'allusion';
      if (kind === 'allusion' && (sim < 0.62 || un.length < 12)) continue;
      out.push({ a, bnd, id, b: V.b, c: V.c, v: V.v, kind, sim: Math.round(effSim * 100) / 100, unit: u.txt, heard, framed, isRef, diffs, negation, whole: u.whole, alts: occ > 1 ? occ - 1 : 0, len: best.coreLen });
    }
    // one match per verse, strongest first; drop overlaps of the same verse via skipIds
    out.sort((x, y) => (y.isRef - x.isRef) || (y.sim * Math.sqrt(y.len) - x.sim * Math.sqrt(x.len)));
    const res = [];
    for (const m of out) {
      if (m.kind !== 'near' && opts.skipIds && opts.skipIds.has(m.id)) continue;
      // overlapping heard spans: keep only the strongest verse (parallel passages / shared clauses)
      const ov = (r) => Math.min(r.bnd, m.bnd) - Math.max(r.a, m.a);
      if (res.some((r) => ov(r) > 0.5 * Math.min(r.bnd - r.a, m.bnd - m.a))) continue;
      res.push(m);
    }
    for (const m of res) { delete m.a; delete m.bnd; }
    return res.slice(0, 4);
  }

  return { norm, buildIndex, candidates, fuzzyFind, clauses, analyze, verseId, FRAME, FUNC, NEG };
});

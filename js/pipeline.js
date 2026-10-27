/* 聽道 — the offline analysis pipeline for one finalized transcript segment (UMD; shared by the app and the node tests/eval).
   env: { R, C, T, V, D, M?, getBible(), getIdx(), settings, getRules(), addHint(seg,item), addWarning(seg,w) } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TingdaoPipeline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function freshState() { return { prev: '', recent: [], texts: [], themeLast: new Map(), hintSeen: new Map(), vm: [], warnSeen: new Map(), n: 0, c: 0 }; }

  function create(env) {
    const { R, C, T, V, D } = env;
    const pipe = { P: freshState(), seenLabels: new Map() };
    const bible = () => env.getBible();
    const verseLabel = (b, c, v) => R.formatLabel(R.BOOKS[b - 1], { bookId: b, chapter: c, endChapter: c, segments: [[v, v]], whole: false });
    const refFromVerse = (b, c, v, raw) => ({ bookId: b, chapter: c, endChapter: c, segments: [[v, v]], whole: false, raw: raw || '', book: R.BOOKS[b - 1].name, label: verseLabel(b, c, v) });
    const slimRef = (r) => ({ bookId: r.bookId, chapter: r.chapter, endChapter: r.endChapter, segments: r.segments, whole: !!r.whole, label: r.label });
    const verseText = (b, c, v) => { const B = bible(); if (!B) return ''; const t = B.b[b - 1][c - 1][v - 1]; return env.settings.god === '上帝' ? t : t.split(B.god).join('神'); };
    function expandRefs(refs) {
      const out = [], B = bible();
      for (const r of refs) {
        if (r.whole || !B) continue;
        try { for (const v of R.getPassage(B, r, { god: '上帝' }).slice(0, 12)) out.push([r.bookId, v.c, v.v]); } catch {}
      }
      return out;
    }

    pipe.reset = function () { pipe.P = freshState(); pipe.seenLabels = new Map(); };
    pipe.helpers = { verseLabel, refFromVerse, slimRef, verseText, expandRefs };

    /** Process one segment {raw}. Returns analysis {text, changes, refs, marks, newWarnings, newHints}. */
    pipe.process = function (seg) {
      const settings = env.settings, B = bible(), vidx = env.getIdx(), P = pipe.P, seenLabels = pipe.seenLabels;
      let src = seg.raw;
      if (env.Z && settings.s2t !== false) src = env.Z.s2t(src); // transcripts often mix Simplified; the Bible data and rules are Traditional
      src = src.replace(/([\u3400-\u9fff，。！？、；：」』）])[ \t]+(?=[\u3400-\u9fff「『（])/g, '$1'); // stray spaces between Chinese characters (common in ASR transcripts)
      let text = src, changes = [];
      if (settings.correct) { const r = C.apply(src, env.getRules()); text = r.text; changes = r.changes; }
      const refs = R.findRefs(text, { bible: B });
      const a = { text, changes, refs, marks: [], newWarnings: [], newHints: [] };
      seg.a = a;
      P.n++; P.c += text.length; // dedup windows below are measured in characters, not segments (segment length varies a lot: speech chunks vs pasted lines)
      P.recent.push(refs); if (P.recent.length > 3) P.recent.shift();
      P.texts.push(text); if (P.texts.length > 3) P.texts.shift();
      if (B && vidx) {
        const refVerses = expandRefs([].concat(...P.recent));
        let ms = [];
        try { ms = V.analyze(vidx, text, { prev: P.prev, refVerses }); } catch (e) { ms = []; }
        for (const m of ms) {
          P.vm.push({ n: P.c, v: [m.b, m.c, m.v] });
          const label = verseLabel(m.b, m.c, m.v);
          const pos = text.indexOf(m.heard);
          const span = pos >= 0 ? { s: pos, e: pos + m.heard.length } : null;
          if (m.kind === 'near') {
            if (!settings.warn) continue;
            const w = D.misquoteWarning(m, label, verseText(m.b, m.c, m.v));
            if (!w) continue;
            const seen = P.warnSeen.get('mq' + m.id);
            if (seen != null && P.n - seen < 6) continue;
            P.warnSeen.set('mq' + m.id, P.n);
            w.refLabel = label;
            const added = env.addWarning(seg, w);
            if (added) { a.newWarnings.push(added); if (span) a.marks.push({ ...span, type: 'wm', wid: added.id, pri: 2 }); }
          } else {
            if (m.kind === 'quote' && m.isRef) { if (span) a.marks.push({ ...span, type: 'qt', label, heard: m.heard, pri: 3 }); continue; }
            if (!settings.hints) continue;
            const seen = P.hintSeen.get(m.id);
            if (seen != null && P.n - seen < 12) continue;
            P.hintSeen.set(m.id, P.n);
            const it = env.addHint(seg, { kind: m.kind, label, heard: m.heard, refs: [slimRef(refFromVerse(m.b, m.c, m.v))], why: m.kind === 'quote' ? '直接引用經文，但沒有說出處' : `可能是在呼應這節經文（相似度 ${Math.round(m.sim * 100)}%）` });
            a.newHints.push(it);
            if (span) a.marks.push({ ...span, type: 'qt', hid: it.id, label, heard: m.heard, pri: 3 });
          }
        }
        // themes (rolling 3-segment window)
        if (settings.hints) {
          const win = P.texts.join('');
          let nTheme = 0;
          for (const s of T.scoreThemes(win)) {
            if (nTheme >= 2) break;
            const last = P.themeLast.get(s.theme.id);
            if (last != null && P.n - last < 10) continue;
            if (!T.scoreThemes(text, { min: 1 }).some((x) => x.theme.id === s.theme.id)) continue; // must be driven by the new segment
            P.themeLast.set(s.theme.id, P.n); nTheme++;
            const mentioned = new Set([...seenLabels.keys()]);
            const refsT = s.theme.verses.map((v) => { try { return R.lookup(v, B); } catch { return null; } }).filter((r) => r && !mentioned.has(r.label)).slice(0, 4).map(slimRef);
            if (!refsT.length) continue;
            const it = env.addHint(seg, { kind: 'theme', theme: s.theme.name, label: refsT.map((r) => r.label).join('、'), heard: s.hits.slice(0, 3).join('、'), refs: refsT, why: `聽到「${s.hits.slice(0, 3).join('、')}」，相關經文：` });
            a.newHints.push(it);
          }
        }
      }
      // curated doctrinal rules
      if (settings.warn) {
        for (const w of D.check(text, { prev: P.prev })) {
          if (w.suppressed) continue;
          const seen = P.warnSeen.get(w.ruleId);
          if (seen != null && P.c - seen < 560) continue;
          P.warnSeen.set(w.ruleId, P.c);
          const added = env.addWarning(seg, w);
          if (added) { a.newWarnings.push(added); a.marks.push({ s: w.start, e: w.end, type: 'wm', wid: added.id, pri: 1 }); }
        }
      }
      // known verses pulled toward a meaning their context doesn't support (needs the verse cited/recognised nearby, or its evoking words)
      if (settings.warn && D.checkApplied) {
        P.vm = P.vm.filter((x) => P.c - x.n < 420);
        const cited = expandRefs([].concat(...P.recent)).concat(P.vm.map((x) => x.v));
        const ctx = P.prev.slice(-160);
        for (const w of D.checkApplied(ctx + text, ctx.length, cited)) {
          const seen = P.warnSeen.get(w.ruleId);
          if (seen != null && P.c - seen < 1000) continue;
          P.warnSeen.set(w.ruleId, P.c);
          const added = env.addWarning(seg, w);
          if (added) { a.newWarnings.push(added); a.marks.push({ s: w.start, e: w.end, type: 'wm', wid: added.id, pri: 1 }); }
        }
      }
      if (settings.warn && D.checkMisplaced) {
        const books = new Set([].concat(...P.recent).map((r) => r.bookId));
        const ctx = P.prev.slice(-100);
        for (const w of D.checkMisplaced(ctx + text, ctx.length, books)) {
          const seen = P.warnSeen.get(w.ruleId);
          if (seen != null && P.c - seen < 1000) continue;
          P.warnSeen.set(w.ruleId, P.c);
          const added = env.addWarning(seg, w);
          if (added) { a.newWarnings.push(added); a.marks.push({ s: w.start, e: w.end, type: 'wm', wid: added.id, pri: 1 }); }
        }
      }
      for (const r of refs) if (!seenLabels.has(r.label)) seenLabels.set(r.label, r);
      P.prev = (P.prev + text).slice(-200);
      return a;
    };
    return pipe;
  }

  return { create, freshState };
});

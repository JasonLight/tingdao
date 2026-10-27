/* 聽道 — offline extractive summary (UMD). Works on ASR text that often has no punctuation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TingdaoSummary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STOP = new Set('的了是我你他她它們在有就都也不這那和與而及或但如果因為所以一個什麼怎麼可以我們你們他們這個那個還要會能之於到說對被把讓又很更最將已從向給跟吧呢嗎啊喔哦嘛呀著過去來上下中大小多少些點個位次，。！？、；：「」『』（）,.!?;:()'.split(''));
  const CUE = /最重要|重點|記得|所以|因此|總之|換句話說|結論|關鍵|我們需要|我們要|必須|不要|千萬|只有|惟有|唯有|神(?:愛|要|說|的|是)|耶穌|聖經(?:說|告訴)|應許|盼望|因為神/;
  const FILLER = /^(?:好|嗯|呃|那|所以|對|阿們|哈利路亞|弟兄姐妹|各位|大家|請|我們(?:一起)?(?:來)?(?:禱告|翻|看)|歡迎|平安)[，。！\s]*$/;

  function splitUnits(segments) {
    const units = [];
    for (const seg of segments) {
      const parts = String(seg).split(/(?<=[。！？!?；;\n])/);
      for (let p of parts) {
        p = p.trim();
        if (!p) continue;
        if (p.length <= 70) { units.push(p); continue; }
        // long run without terminal punctuation: cut at commas into ~30-60 char clauses
        const cl = p.split(/(?<=[，,、])/);
        let cur = '';
        for (const c of cl) {
          if ((cur + c).length > 60 && cur) { units.push(cur); cur = c; } else cur += c;
        }
        if (cur) units.push(cur);
      }
    }
    return units;
  }

  function bigrams(s) {
    const out = [];
    const t = s.replace(/[\s，。！？、；：「」『』（）,.!?;:()]/g, '');
    for (let i = 0; i + 1 < t.length; i++) { const a = t[i], b = t[i + 1]; if (!STOP.has(a) && !STOP.has(b)) out.push(a + b); }
    return out;
  }

  /** segments: string[]; opts: {refs:[label], themes:[{name}], max} */
  function summarize(segments, opts) {
    opts = opts || {};
    segments = (segments || []).filter(Boolean);
    const units = splitUnits(segments);
    const chars = segments.reduce((n, s) => n + s.length, 0);
    const refs = (opts.refs || []).slice();
    const themes = (opts.themes || []).map((t) => (typeof t === 'string' ? t : t.name));
    const freq = new Map();
    for (const u of units) for (const b of new Set(bigrams(u))) freq.set(b, (freq.get(b) || 0) + 1);
    const cand = [];
    units.forEach((u, i) => {
      const clean = u.replace(/\s+/g, '');
      if (clean.length < 12 || FILLER.test(clean)) return;
      const bg = [...new Set(bigrams(u))];
      if (!bg.length) return;
      let s = 0; for (const b of bg) { const f = freq.get(b); if (f > 1) s += Math.min(f, 6); }
      s = s / Math.sqrt(bg.length + 8);
      if (CUE.test(u)) s *= 1.25;
      if (refs.some((r) => u.includes(r.split(' ')[0]))) s *= 1.1;
      if (clean.length > 90) s *= 0.8;
      cand.push({ i, u: u.trim(), s, bg: new Set(bg) });
    });
    const n = Math.max(2, Math.min(opts.max || 7, Math.round(units.length / 6) || 2));
    const picked = [];
    for (const c of cand.slice().sort((a, b) => b.s - a.s)) {
      if (picked.length >= n) break;
      if (c.s <= 0) break;
      const red = picked.some((p) => { let k = 0; for (const b of c.bg) if (p.bg.has(b)) k++; return k / Math.min(c.bg.size, p.bg.size) > 0.5; });
      if (!red) picked.push(c);
    }
    picked.sort((a, b) => a.i - b.i);
    const points = picked.map((p) => p.u.replace(/^[，、；\s]+/, '').replace(/[，、；]$/, '。'));
    let title;
    if (themes[0]) title = themes[0] + (refs[0] ? '・' + refs[0] : '');
    else if (refs[0]) title = refs[0] + ' 講道';
    else { const f = (units.find((u) => u.length >= 8) || units[0] || '未命名講道').replace(/[，。！？\s]+$/g, ''); title = f.length > 18 ? f.slice(0, 18) + '…' : f; }
    return { title, points, verses: refs, themes, stats: { chars, units: units.length }, src: 'offline' };
  }

  function toText(sm) {
    const L = [];
    if (sm.points && sm.points.length) { L.push('重點：'); sm.points.forEach((p, i) => L.push(`${i + 1}. ${p}`)); }
    if (sm.themes && sm.themes.length) L.push('主題：' + sm.themes.join('、'));
    if (sm.verses && sm.verses.length) L.push('經文：' + sm.verses.join('、'));
    return L.join('\n');
  }

  return { summarize, splitUnits, bigrams, toText };
});

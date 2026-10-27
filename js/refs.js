/* 聽道 — Bible reference parser (UMD: works in browser as window.TingdaoRefs and in node via require) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TingdaoRefs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // id, full name, standard 和合本 abbreviation, extra aliases (full-name variants / short forms)
  const BOOKS = [
    [1, '創世記', '創', ['創世紀']],
    [2, '出埃及記', '出', ['出埃及']],
    [3, '利未記', '利', ['利未']],
    [4, '民數記', '民', ['民數']],
    [5, '申命記', '申', ['申命']],
    [6, '約書亞記', '書', ['約書亞']],
    [7, '士師記', '士', ['士師']],
    [8, '路得記', '得', ['路得']],
    [9, '撒母耳記上', '撒上', ['撒母耳上', '撒母耳記上']],
    [10, '撒母耳記下', '撒下', ['撒母耳下']],
    [11, '列王紀上', '王上', ['列王記上', '列王上']],
    [12, '列王紀下', '王下', ['列王記下', '列王下']],
    [13, '歷代志上', '代上', ['歷代誌上', '歷代上']],
    [14, '歷代志下', '代下', ['歷代誌下', '歷代下']],
    [15, '以斯拉記', '拉', ['以斯拉']],
    [16, '尼希米記', '尼', ['尼希米']],
    [17, '以斯帖記', '斯', ['以斯帖']],
    [18, '約伯記', '伯', ['約伯']],
    [19, '詩篇', '詩', []],
    [20, '箴言', '箴', []],
    [21, '傳道書', '傳', ['傳道']],
    [22, '雅歌', '歌', []],
    [23, '以賽亞書', '賽', ['以賽亞']],
    [24, '耶利米書', '耶', ['耶利米']],
    [25, '耶利米哀歌', '哀', ['哀歌']],
    [26, '以西結書', '結', ['以西結']],
    [27, '但以理書', '但', ['但以理']],
    [28, '何西阿書', '何', ['何西阿']],
    [29, '約珥書', '珥', ['約珥']],
    [30, '阿摩司書', '摩', ['阿摩司']],
    [31, '俄巴底亞書', '俄', ['俄巴底亞']],
    [32, '約拿書', '拿', ['約拿']],
    [33, '彌迦書', '彌', ['彌迦']],
    [34, '那鴻書', '鴻', ['那鴻']],
    [35, '哈巴谷書', '哈', ['哈巴谷']],
    [36, '西番雅書', '番', ['西番雅']],
    [37, '哈該書', '該', ['哈該']],
    [38, '撒迦利亞書', '亞', ['撒迦利亞']],
    [39, '瑪拉基書', '瑪', ['瑪拉基']],
    [40, '馬太福音', '太', ['馬太']],
    [41, '馬可福音', '可', ['馬可']],
    [42, '路加福音', '路', ['路加']],
    [43, '約翰福音', '約', ['約翰']],
    [44, '使徒行傳', '徒', ['行傳']],
    [45, '羅馬書', '羅', ['羅馬']],
    [46, '哥林多前書', '林前', ['哥林多前', '哥前']],
    [47, '哥林多後書', '林後', ['哥林多後', '哥後']],
    [48, '加拉太書', '加', ['加拉太']],
    [49, '以弗所書', '弗', ['以弗所']],
    [50, '腓立比書', '腓', ['腓立比']],
    [51, '歌羅西書', '西', ['歌羅西']],
    [52, '帖撒羅尼迦前書', '帖前', ['帖撒羅尼迦前']],
    [53, '帖撒羅尼迦後書', '帖後', ['帖撒羅尼迦後']],
    [54, '提摩太前書', '提前', ['提摩太前']],
    [55, '提摩太後書', '提後', ['提摩太後']],
    [56, '提多書', '多', ['提多']],
    [57, '腓利門書', '門', ['腓利門']],
    [58, '希伯來書', '來', ['希伯來']],
    [59, '雅各書', '雅', ['雅各']],
    [60, '彼得前書', '彼前', ['彼得前']],
    [61, '彼得後書', '彼後', ['彼得後']],
    [62, '約翰一書', '約壹', ['約翰壹書']],
    [63, '約翰二書', '約貳', ['約翰貳書']],
    [64, '約翰三書', '約參', ['約翰參書', '約叁', '約翰叁書']],
    [65, '猶大書', '猶', ['猶大']],
    [66, '啟示錄', '啟', ['啓示錄', '啟示', '啓']],
  ].map(([id, name, abbr, aliases]) => ({ id, name, abbr, aliases }));

  // books that have only one chapter -> "猶 3節" means 猶大書 1:3
  const SINGLE_CHAPTER = new Set([31, 57, 63, 64, 65]);

  // alias -> book id
  const ALIAS = new Map();
  for (const b of BOOKS) {
    for (const a of [b.name, b.abbr, ...b.aliases]) {
      if (!ALIAS.has(a)) ALIAS.set(a, b.id);
    }
  }
  // 1-char abbreviations are very ambiguous in ordinary Chinese ("但3個人", "可以3:00") so they need chapter AND verse.
  const isSingle = (a) => a.length === 1;
  // previous characters that make a 1-char abbreviation part of a common word (大約3:30, 契約, 道路, 不可…)
  const NOT_AFTER = {
    '約': '大契預婚條舊新立盟簽', '路': '道馬公大走鐵之', '太': '不', '可': '不', '書': '圖讀聖文', '來': '未後本原由將從',
    '但': '', '多': '很許', '加': '增', '傳': '宣', '出': '', '得': '取記獲', '何': '不', '利': '勝便', '民': '人公',
    '申': '', '士': '', '王': '', '拉': '', '尼': '', '斯': '', '歌': '', '結': '', '亞': '', '瑪': '', '西': '', '弗': '',
  };
  const aliasList = [...ALIAS.keys()].sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const BOOK_RE = new RegExp(aliasList.map(esc).join('|'), 'g');

  // ---------- numbers ----------
  const CN_DIGIT = { '零': 0, '〇': 0, '○': 0, '一': 1, '二': 2, '兩': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const CN_NUM_CHARS = '零〇○一二兩两三四五六七八九十百';
  const isArabic = (c) => c !== undefined && /[0-9０-９]/.test(c);
  const isCnNum = (c) => c !== undefined && CN_NUM_CHARS.includes(c);

  function cnToInt(s) {
    // supports 十, 十一, 二十, 二十三, 一百, 一百零五, 一百一十九, 一百五十, 二〇 (digit-by-digit)
    if (!/[十百]/.test(s)) {
      let n = 0;
      for (const c of s) n = n * 10 + (CN_DIGIT[c] ?? 0);
      return n;
    }
    let total = 0, cur = 0, seenHundred = false;
    for (const c of s) {
      if (c === '百') { total += (cur || 1) * 100; cur = 0; seenHundred = true; }
      else if (c === '十') { total += (cur || 1) * 10; cur = 0; }
      else if (c in CN_DIGIT) cur = CN_DIGIT[c];
    }
    return total + cur;
  }
  // Reads a number at s[i]; returns {n, end, kind} or null
  function readNum(s, i) {
    const c = s[i];
    if (isArabic(c)) {
      let j = i, v = 0;
      while (j < s.length && isArabic(s[j])) { v = v * 10 + (s.charCodeAt(j) >= 0xff10 ? s.charCodeAt(j) - 0xff10 : +s[j]); j++; }
      return { n: v, end: j, kind: 'ar' };
    }
    if (isCnNum(c)) {
      let j = i;
      while (j < s.length && isCnNum(s[j])) j++;
      const n = cnToInt(s.slice(i, j));
      return { n, end: j, kind: 'cn' };
    }
    return null;
  }

  const SP = /[ \t\u3000\u00a0]/;
  function skipSp(s, i) { while (i < s.length && SP.test(s[i])) i++; return i; }
  const isCJK = (c) => c !== undefined && /[\u3400-\u9fff]/.test(c);
  const COLONS = ':：';
  const RANGE = '-–—－~～到至';
  const LIST = ',，、和及';

  // verse-spec after chapter is known. Returns {segments:[[a,b]], endChapter, end} or null
  // segments are within `chapter` unless endChapter>chapter (cross-chapter range: single segment from a (ch) to b (endChapter))
  function readVerses(s, i, chapter, opts) {
    let p = skipSp(s, i);
    if (s[p] === '第') p = skipSp(s, p + 1);
    const first = readNum(s, p);
    if (!first) return null;
    let q = first.end;
    let hadJie = false;
    let q2 = skipSp(s, q);
    if (s[q2] === '節' || s[q2] === '节') { hadJie = true; q = q2 + 1; }
    else if (opts.requireJie && first.kind === 'cn') return null;
    else {
      // bare number without 節: only OK if not directly followed by another CJK char (e.g. "3章3個人")
      const nx = s[q];
      if (isCJK(nx) && !RANGE.includes(nx) && !(opts.colon && first.kind === 'ar')) return null;
      if (nx !== undefined && isArabic(nx)) return null;
    }
    const segments = [[first.n, first.n]];
    let endChapter = chapter;
    let end = q;
    // range / list loop
    for (let guard = 0; guard < 6; guard++) {
      let r = skipSp(s, end);
      const c = s[r];
      if (c !== undefined && RANGE.includes(c)) {
        r = skipSp(s, r + 1);
        if (s[r] === '第') r = skipSp(s, r + 1);
        const n2 = readNum(s, r);
        if (!n2) break;
        let after = skipSp(s, n2.end);
        // cross-chapter: 3:16-4:2  or 3章16節到4章2節
        if (COLONS.includes(s[after]) || s[after] === '章') {
          const v3 = readNum(s, skipSp(s, after + 1) + (s[skipSp(s, after + 1)] === '第' ? 1 : 0));
          if (v3 && n2.n >= chapter) {
            let e = v3.end; const e2 = skipSp(s, e);
            if (s[e2] === '節' || s[e2] === '节') e = e2 + 1;
            const last = segments[segments.length - 1];
            endChapter = n2.n;
            segments[segments.length - 1] = [last[0], v3.n];
            end = e; break;
          }
          break;
        }
        let e = n2.end;
        if (s[after] === '節' || s[after] === '节') e = after + 1;
        else if (isCJK(s[e]) && !LIST.includes(s[e]) && n2.kind !== 'ar' && !hadJie) break;
        const last = segments[segments.length - 1];
        if (n2.n >= last[0]) segments[segments.length - 1] = [last[0], n2.n];
        end = e;
        continue;
      }
      if (c !== undefined && LIST.includes(c) && endChapter === chapter) {
        let r2 = skipSp(s, r + 1);
        if (s[r2] === '第') r2 = skipSp(s, r2 + 1);
        const n2 = readNum(s, r2);
        if (!n2) break;
        const after = skipSp(s, n2.end);
        if (s[after] === '章' || s[after] === '篇' || COLONS.includes(s[after])) break; // a new chapter ref, not a verse list
        const hasJie = s[after] === '節' || s[after] === '节';
        if (!hasJie && isCJK(s[n2.end])) break;      // "，17人"
        if (!hasJie && n2.kind === 'cn') break;      // too ambiguous without 節
        if (!hasJie && isArabic(s[n2.end])) break;
        if ('和及'.includes(c) && !hasJie && !hadJie) break;
        segments.push([n2.n, n2.n]);
        end = hasJie ? after + 1 : n2.end;
        continue;
      }
      break;
    }
    return { segments, endChapter, end };
  }

  function formatLabel(book, ref) {
    const name = book.name;
    if (ref.whole) return `${name} ${ref.chapter}${ref.bookId === 19 ? '篇' : '章'}`;
    if (ref.endChapter > ref.chapter) {
      const [a, b] = ref.segments[0];
      return `${name} ${ref.chapter}:${a}-${ref.endChapter}:${b}`;
    }
    const parts = ref.segments.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`));
    return `${name} ${ref.chapter}:${parts.join(',')}`;
  }

  // Try to parse reference tail starting right after a book alias (position i). Returns ref or null.
  function parseTail(s, i, bookId, single) {
    let p = skipSp(s, i);
    if (s[p] === '第') p = skipSp(s, p + 1);
    const n1 = readNum(s, p);
    if (!n1) return null;
    let q = skipSp(s, n1.end);
    const m = s[q];
    // 1) chapter:verse
    if (m !== undefined && COLONS.includes(m)) {
      const v = readVerses(s, q + 1, n1.n, { requireJie: false, colon: true });
      if (!v) return null;
      return mk(bookId, n1.n, v, i, s);
    }
    // 2) chapter 章/篇 [verse]
    if (m === '章' || m === '篇') {
      const v = readVerses(s, q + 1, n1.n, { requireJie: false });
      if (v) return mk(bookId, n1.n, v, i, s);
      // whole chapter
      if (single && !(m === '篇' && bookId === 19)) return null;
      return { bookId, chapter: n1.n, endChapter: n1.n, segments: [], whole: true, end: q + 1 };
    }
    // 3) single-chapter book + verse: 猶大書 3節
    if ((m === '節' || m === '节') && SINGLE_CHAPTER.has(bookId)) {
      const v = readVerses(s, p, 1, { requireJie: false });
      if (v) return mk(bookId, 1, v, i, s);
    }
    return null;
  }
  function mk(bookId, chapter, v, _i, _s) {
    return { bookId, chapter, endChapter: v.endChapter, segments: v.segments, whole: false, end: v.end };
  }

  /**
   * Find all Bible references in text.
   * @param {string} text
   * @param {object} [opts] {bible: loaded cuv json (to validate & clip), keepInvalid:boolean}
   * @returns {Array<{start,end,raw,bookId,book,chapter,endChapter,segments,whole,label,abbrUsed}>}
   */
  function findRefs(text, opts) {
    opts = opts || {};
    const out = [];
    let pos = 0;
    BOOK_RE.lastIndex = 0;
    let m;
    while ((m = BOOK_RE.exec(text))) {
      const start = m.index;
      if (start < pos) { continue; }
      const alias = m[0];
      const bookId = ALIAS.get(alias);
      const single = isSingle(alias);
      if (single) {
        const prev = text[start - 1];
        if (prev && NOT_AFTER[alias] && NOT_AFTER[alias].includes(prev)) continue;
        if (prev && /[A-Za-z0-9]/.test(prev)) continue;
      }
      let ref = parseTail(text, start + alias.length, bookId, single);
      if (!ref) { BOOK_RE.lastIndex = start + alias.length; continue; }
      if (single && ref.whole && bookId !== 19) continue; // 1-char abbreviations need chapter+verse (詩23篇 is the one exception)
      const book = BOOKS[bookId - 1];
      ref.start = start;
      ref.raw = text.slice(start, ref.end);
      ref.book = book.name;
      ref.abbrUsed = alias;
      if (opts.bible) {
        const ok = validate(ref, opts.bible);
        if (!ok) { if (!opts.keepInvalid) { BOOK_RE.lastIndex = start + alias.length; continue; } ref.invalid = true; }
      }
      ref.label = formatLabel(book, ref);
      out.push(ref);
      pos = ref.end;
      BOOK_RE.lastIndex = ref.end;
    }
    return out;
  }

  // validate against bible data and clip ranges to the chapter's last verse. Mutates ref. Returns bool.
  function validate(ref, bible) {
    const bk = bible.b[ref.bookId - 1];
    if (!bk) return false;
    if (ref.chapter < 1 || ref.chapter > bk.length) return false;
    if (ref.whole) return true;
    if (ref.endChapter > bk.length) return false;
    const maxStart = bk[ref.chapter - 1].length;
    if (ref.endChapter > ref.chapter) {
      const [a, b] = ref.segments[0];
      if (a < 1 || a > maxStart) return false;
      ref.segments[0] = [a, Math.min(b, bk[ref.endChapter - 1].length)];
      return b >= 1;
    }
    const segs = [];
    for (const [a, b] of ref.segments) {
      if (a < 1 || a > maxStart) continue;
      segs.push([a, Math.min(b, maxStart)]);
    }
    if (!segs.length) return false;
    ref.segments = segs;
    return true;
  }

  /** Resolve a ref to verse list [{c, v, text, hit}] (whole chapter -> all verses; hit marks the referenced verses). */
  function getPassage(bible, ref, opts) {
    opts = opts || {};
    const bk = bible.b[ref.bookId - 1];
    const god = opts.god === '上帝' ? null : bible.god; // default 神版: replace 上帝 -> 神
    const fix = (t) => (!t ? '（和合本此節從缺）' : god ? t.split(god).join('神') : t);
    const out = [];
    const push = (c, v, hit) => out.push({ c, v, text: fix(bk[c - 1][v - 1]), hit });
    if (ref.whole) {
      for (let v = 1; v <= bk[ref.chapter - 1].length; v++) push(ref.chapter, v, true);
      return out;
    }
    if (ref.endChapter > ref.chapter) {
      const [a, b] = ref.segments[0];
      for (let c = ref.chapter; c <= ref.endChapter; c++) {
        const from = c === ref.chapter ? a : 1;
        const to = c === ref.endChapter ? b : bk[c - 1].length;
        for (let v = from; v <= to; v++) push(c, v, true);
      }
      return out;
    }
    for (const [a, b] of ref.segments) for (let v = a; v <= b; v++) push(ref.chapter, v, true);
    return out;
  }

  /** Parse a free-typed lookup like "約 3:16" or "創世記1章1節"; returns first ref or null. */
  function lookup(text, bible) {
    const r = findRefs(text.trim(), { bible });
    return r.length ? r[0] : null;
  }

  return { BOOKS, ALIAS, findRefs, getPassage, lookup, cnToInt, readNum, validate, formatLabel };
});

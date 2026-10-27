/* 聽道 — light auto-correction of common Christian vocabulary mis-recognitions (UMD). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TingdaoCorrections = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 正確詞=錯誤寫法1,錯誤寫法2   (one rule per line; editable in the app, saved in localStorage)
  const DEFAULT_TEXT = [
    '# 格式：正確詞=常見誤辨1,誤辨2   （# 開頭為註解）',
    '以馬內利=以馬內力,以馬內裡,一馬內利,以媽內利,以馬利內,以馬內麗',
    '哈利路亞=哈利路呀,哈里路亞,哈利魯亞,哈利路牙,哈利陸亞,哈裡路亞',
    '阿們=阿門,啊們,亞們,阿悶',
    '耶和華=耶和花,耶和話,也和華,爺和華,耶合華,耶河華',
    '耶穌=耶蘇,夜穌,爺穌,耶酥',
    '基督=既督,基度,記督',
    '彌賽亞=米賽亞,迷賽亞,彌塞亞,米塞亞',
    '聖靈=聖零,聖玲,聖領',
    '十字架=十字價,十字駕,十字嫁',
    '福音=福因,服音',
    '恩典=恩點,恩店',
    '救贖=救續',
    '悔改=悔該',
    '撒但=撒旦,薩但,薩旦',
    '哥林多=歌林多,哥林朵',
    '以弗所=以佛所,一弗所,以弗索',
    '腓立比=非立比,菲立比,飛立比',
    '歌羅西=哥羅西,歌羅希',
    '帖撒羅尼迦=貼撒羅尼迦,帖薩羅尼迦,貼薩羅尼迦',
    '提摩太=提摩泰,提摩台,堤摩太',
    '提多書=提多樹',
    '以賽亞=以塞亞,以賽雅,以賽啞',
    '耶利米=耶利美,耶力米',
    '以西結=以西潔,以西傑',
    '但以理=但以裡,但以李',
    '亞伯拉罕=亞伯拉汗,亞伯拉含,亞伯拉漢',
    '摩西=魔西,磨西',
    '保羅=寶羅,保蘿',
    '彼得=比得',
    '使徒行傳=使徒行轉,使徒行專',
    '啟示錄=啓示錄',
    '馬太福音=馬太福因,瑪太福音',
    '路加福音=路加福因',
    '羅馬書=羅馬樹,羅馬輸',
    '希伯來書=希伯來樹,希伯來輸',
    '聖經=聖京,聖精',
  ].join('\n');

  function parse(text) {
    const rules = [];
    for (let line of (text || '').split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 1) continue;
      const to = line.slice(0, i).trim();
      for (const from of line.slice(i + 1).split(/[,，、]/)) {
        const f = from.trim();
        if (f && f !== to) rules.push({ from: f, to });
      }
    }
    // longest first so that longer wrong forms win
    rules.sort((a, b) => b.from.length - a.from.length);
    return rules;
  }

  /** Apply rules. Returns {text, changes:[{from,to,start,end}]} where start/end are positions in the OUTPUT text. */
  function apply(text, rules) {
    if (!rules || !rules.length) return { text, changes: [] };
    const re = new RegExp(rules.map((r) => r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const map = new Map(rules.map((r) => [r.from, r.to]));
    let out = '', last = 0, m;
    const changes = [];
    while ((m = re.exec(text))) {
      out += text.slice(last, m.index);
      const to = map.get(m[0]);
      changes.push({ from: m[0], to, start: out.length, end: out.length + to.length });
      out += to;
      last = m.index + m[0].length;
    }
    out += text.slice(last);
    return { text: out, changes };
  }

  return { DEFAULT_TEXT, parse, apply };
});

// Offline Code128-B barcode generator → SVG. No library, no network.
// Used to print scannable labels for loose/unpackaged items that have no printed barcode.
const Barcode = (() => {
  // Standard Code128 bar/space width patterns, index = symbol value (0..106).
  const PATTERNS = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
    '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
    '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
    '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
    '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
    '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
    '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
    '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
    '114131','311141','411131','211412','211214','211232','233111'
  ];
  const STOP = '2331112'; // includes the final guard bar
  const START_B = 104;

  // Encode an ASCII string (Code128-B charset, 32..126) into a module bit string.
  function encode(text) {
    const vals = [START_B];
    let sum = START_B;
    for (let i = 0; i < text.length; i++) {
      const v = text.charCodeAt(i) - 32; // Set B: space(32)=0 … '~'(126)=94
      if (v < 0 || v > 94) continue;
      vals.push(v);
      sum += v * (i + 1);
    }
    vals.push(sum % 103);              // checksum
    let bits = '';
    vals.forEach((v) => { bits += widthsToBits(PATTERNS[v]); });
    bits += widthsToBits(STOP);
    return bits;
  }

  // "212222" → bars/spaces starting with a bar (1), alternating.
  function widthsToBits(widths) {
    let out = '', bar = true;
    for (const ch of widths) {
      const n = parseInt(ch, 10);
      out += (bar ? '1' : '0').repeat(n);
      bar = !bar;
    }
    return out;
  }

  // Build an SVG string for the given value. opts: {height, moduleWidth, showText}
  function toSVG(text, opts) {
    opts = opts || {};
    const mw = opts.moduleWidth || 1.6;
    const h = opts.height || 48;
    const quiet = 10;
    const bits = encode(String(text));
    const width = (bits.length + quiet * 2) * mw;
    const textH = opts.showText === false ? 0 : 16;
    let rects = '';
    let x = quiet * mw;
    let i = 0;
    while (i < bits.length) {
      if (bits[i] === '1') {
        let run = 1;
        while (bits[i + run] === '1') run++;
        rects += `<rect x="${x.toFixed(2)}" y="0" width="${(run * mw).toFixed(2)}" height="${h}" fill="#000"/>`;
        x += run * mw; i += run;
      } else {
        x += mw; i += 1;
      }
    }
    const label = opts.showText === false ? '' :
      `<text x="${width / 2}" y="${h + 13}" text-anchor="middle" font-family="monospace" font-size="13">${String(text)}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${h + textH}" viewBox="0 0 ${width.toFixed(0)} ${h + textH}">`
      + `<rect width="100%" height="100%" fill="#fff"/>${rects}${label}</svg>`;
  }

  return { toSVG };
})();

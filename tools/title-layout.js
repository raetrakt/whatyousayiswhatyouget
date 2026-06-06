// Shared title typesetting + title-SVG mask logic.
// Used by the tools editor (tools/main.js) and the thesis title animation
// (src/thesis/title-resampling.js) so the "A4/16:9 → SVG mask, otherwise
// typeset with opentype" decision lives in exactly one place.

export const A4 = 1 / Math.SQRT2;
export const TITLE_SVG_URL = new URL('../assets/svg/title_layout.svg', import.meta.url).href;
export const TITLE_16BY9_SVG_URL = new URL('../assets/svg/title_16by9.svg', import.meta.url).href;

export function measureWidth(font, str, fontSize, tracking) {
  const scale = fontSize / font.unitsPerEm;
  const chars = [...str];
  const glyphs = chars.map((ch) => font.charToGlyph(ch));
  let w = 0;
  for (let i = 0; i < glyphs.length; i++) {
    w += glyphs[i].advanceWidth * scale + tracking;
    if (i < glyphs.length - 1) w += font.getKerningValue(glyphs[i], glyphs[i + 1]) * scale;
  }
  return w - tracking; // no trailing space after last char
}

export function wrapWords(font, text, maxWidth, fontSize, tracking) {
  const lines = [];
  for (const manualLine of text.split('\n')) {
    const trimmed = manualLine.trimEnd(); // preserve leading spaces, strip trailing
    if (!trimmed || measureWidth(font, trimmed, fontSize, tracking) <= maxWidth) {
      lines.push(trimmed);
      continue;
    }
    // Split into alternating word-runs and space-runs to preserve spacing
    const tokens = trimmed.split(/( +)/);
    let line = '';
    for (const token of tokens) {
      const isSpace = /^ +$/.test(token);
      const candidate = line + token;
      if (line && measureWidth(font, candidate, fontSize, tracking) > maxWidth) {
        lines.push(line.trimEnd());
        line = isSpace ? '' : token; // drop inter-word spaces at break points
      } else {
        line = candidate;
      }
    }
    if (line.trim()) lines.push(line);
  }
  return lines;
}

export function fitFontSize(font, text, params, w, h) {
  const maxW = w - params.margin * 2;
  const maxH = h - params.margin * 2;
  let lo = 1,
    hi = h * 0.5;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const lines = wrapWords(font, text, maxW, mid, params.tracking);
    const scale = mid / font.unitsPerEm;
    const lineH = (font.ascender - font.descender) * scale * params.leading;
    const widest = Math.max(...lines.map((l) => measureWidth(font, l, mid, params.tracking)));
    if (lines.length * lineH < maxH && widest < maxW) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Full text layout → { lines, fontSize, startY, lineH }.
// `params.margin` is expected in pixels.
export function layoutText(font, text, params, w, h) {
  const fontSize = params.fontSize > 0 ? params.fontSize : fitFontSize(font, text, params, w, h);
  const maxW = w - params.margin * 2;
  const lines = wrapWords(font, text, maxW, fontSize, params.tracking);
  const scale = fontSize / font.unitsPerEm;
  const lineH = (font.ascender - font.descender) * scale * params.leading;
  const firstChar = [...text].find((c) => c.trim()) || 'M';
  const topOffset = font.charToGlyph(firstChar).getBoundingBox().y2 * scale;
  const descenderOffset = -font.descender * scale;
  const blockH = topOffset + (lines.length - 1) * lineH + descenderOffset;
  let startY;
  if (params.valign === 'bottom') startY = h - params.margin - blockH + topOffset;
  else if (params.valign === 'center') startY = (h - blockH) / 2 + topOffset;
  else startY = params.margin + topOffset;
  return { lines, fontSize, startY, lineH };
}

// Classify the title aspect ratio: 'a4' | '16by9' | 'text'.
export function titleKind(params) {
  const ratio = params.width / params.height;
  if (Math.abs(ratio - A4) < 0.01) return 'a4';
  if (Math.abs(ratio - 16 / 9) < 0.01) return '16by9';
  return 'text';
}

// SVG asset URL for the params ratio, or null when text should be typeset.
export function titleUrl(params) {
  const kind = titleKind(params);
  if (kind === '16by9') return TITLE_16BY9_SVG_URL;
  if (kind === 'a4') return TITLE_SVG_URL;
  return null;
}

// Placement rect for the title SVG. `params.margin` is expected in pixels.
export function titleRect(img, params, w, h) {
  const m = params.margin;
  const rw = w - m * 2;
  const rh = (img.naturalHeight / img.naturalWidth) * rw;
  let y;
  if (params.valign === 'bottom') y = h - m - rh;
  else if (params.valign === 'center') y = (h - rh) / 2;
  else y = m;
  return { x: m, y, w: rw, h: rh };
}

// Fresh white mask canvas.
export function blankMask(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cx = c.getContext('2d');
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, w, h);
  return c;
}

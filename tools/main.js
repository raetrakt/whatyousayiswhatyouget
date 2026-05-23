import { EditorView, minimalSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { parse as parseFont } from 'opentype.js';

const FONT_URL = new URL('../assets/fonts/texgyretermes-regular.otf', import.meta.url).href;
const TITLE_SVG_URL = new URL('../assets/svg/title_layout.svg', import.meta.url).href;
const A4 = 1 / Math.SQRT2;

const INITIAL_CODE = [
  'const text = "What You Say Is What You Get?"',
  '',
  'const params = {',
  '  fontSize: 160, // null = auto-fit',
  '  leading: .6,',
  '  margin: 80,   // px whitespace on each side',
  '  tracking: -3,  // px added between characters',
  '  width: 210,   // mm',
  '  height: 297,  // mm',
  '}',
].join('\n');

let font = null;
let cssW = 0;
let cssH = 0;
let fontLoaded = false;
let renderTimer = null;

const editorView = new EditorView({
  doc: INITIAL_CODE,
  extensions: [
    minimalSetup,
    javascript(),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) scheduleRender();
    }),
  ],
  parent: document.getElementById('editor'),
});

const canvas = document.getElementById('sketch');
const ctx = canvas.getContext('2d');
const canvasPanel = document.getElementById('canvas-panel');

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const style = getComputedStyle(canvasPanel);
  const pw =
    canvasPanel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const ph =
    canvasPanel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (pw / ph < A4) {
    cssW = Math.floor(pw);
    cssH = Math.floor(pw / A4);
  } else {
    cssH = Math.floor(ph);
    cssW = Math.floor(ph * A4);
  }
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

new ResizeObserver(resizeCanvas).observe(canvasPanel);

function measureWidth(str, fontSize, tracking) {
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

function drawLine(line, x, y, fontSize, tracking) {
  const scale = fontSize / font.unitsPerEm;
  const chars = [...line];
  const glyphs = chars.map((ch) => font.charToGlyph(ch));
  let cx = x;
  for (let i = 0; i < glyphs.length; i++) {
    font.draw(ctx, chars[i], cx, y, fontSize);
    const kern = i < glyphs.length - 1 ? font.getKerningValue(glyphs[i], glyphs[i + 1]) * scale : 0;
    cx += glyphs[i].advanceWidth * scale + tracking + kern;
  }
}

function wrapWords(text, maxWidth, fontSize, tracking) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureWidth(candidate, fontSize, tracking) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitFontSize(text, params) {
  const maxW = cssW - params.margin * 2;
  const maxH = cssH - params.margin * 2;
  let lo = 1, hi = cssH * 0.5;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const lines = wrapWords(text, maxW, mid, params.tracking);
    const scale = mid / font.unitsPerEm;
    const lineH = (font.ascender - font.descender) * scale * params.leading;
    const widest = Math.max(...lines.map(l => measureWidth(l, mid, params.tracking)));
    if (lines.length * lineH < maxH && widest < maxW) lo = mid;
    else hi = mid;
  }
  return lo;
}

function evaluate(code) {
  try {
    const fn = new Function(`
      ${code}
      return {
        text: typeof text !== 'undefined' ? text : null,
        params: typeof params !== 'undefined' ? params : null,
      }
    `);
    return fn();
  } catch (err) {
    console.warn('evaluate error:', err.message);
    return null;
  }
}

function render() {
  if (!cssW || !fontLoaded) return;
  const result = evaluate(editorView.state.doc.toString());
  const text = (typeof result?.text === 'string' && result.text) || 'What You Say Is What You Get?';
  const p = result?.params || {};
  const params = {
    fontSize: p.fontSize ?? null,
    leading: p.leading ?? 1.2,
    margin: p.margin ?? 40,
    tracking: p.tracking ?? 0,
    width: p.width ?? 210,
    height: p.height ?? 297,
  };

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);

  const isA4 = Math.abs(params.width / params.height - A4) < 0.01;
  if (text === 'What You Say Is What You Get?' && isA4) {
    const m = params.margin;
    const img = new Image();
    img.onload = () => {
      const svgW = cssW - m * 2;
      const svgH = (img.naturalHeight / img.naturalWidth) * svgW;
      ctx.drawImage(img, m, m, svgW, svgH);
    };
    img.src = TITLE_SVG_URL;
    return;
  }

  const fontSize = params.fontSize > 0 ? params.fontSize : fitFontSize(text, params);
  const maxW = cssW - params.margin * 2;
  const lines = wrapWords(text, maxW, fontSize, params.tracking);

  const scale = fontSize / font.unitsPerEm;
  const lineH = (font.ascender - font.descender) * scale * params.leading;
  const firstChar = [...text].find(c => c.trim()) || 'M';
  const topOffset = font.charToGlyph(firstChar).getBoundingBox().y2 * scale;
  const startY = params.margin + topOffset;

  ctx.fillStyle = '#000000';

  for (let i = 0; i < lines.length; i++) {
    const lw = measureWidth(lines[i], fontSize, params.tracking);
    const x = (cssW - lw) / 2;
    const y = startY + i * lineH;
    drawLine(lines[i], x, y, fontSize, params.tracking);
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 250);
}

window.__tools = {
  editorView,
  canvas,
  ctx,
  render,
  get font() {
    return font;
  },
};

async function init() {
  const response = await fetch(FONT_URL);
  const buffer = await response.arrayBuffer();
  font = parseFont(buffer);
  fontLoaded = true;
  resizeCanvas();
}

init().catch((err) => console.error('Init failed:', err));

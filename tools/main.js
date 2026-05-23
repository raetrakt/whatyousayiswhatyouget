import { EditorView, minimalSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { parse as parseFont } from 'opentype.js';
import { render as renderSDF, defaults as sdfDefaults } from './sdf/sdf.js';
import { colorPickerExt } from './color-picker-ext.js';

const FONT_URL = new URL('../assets/fonts/texgyretermes-regular.otf', import.meta.url).href;
const TITLE_SVG_URL = new URL('../assets/svg/title_layout.svg', import.meta.url).href;
const A4 = 1 / Math.SQRT2;

function _fmtVal(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

const INITIAL_CODE = [
  'const text = "What You Say Is What You Get?"',
  '',
  'const params = {',
  '  fontSize: 160,         // null = auto-fit',
  '  leading: .6,',
  '  margin: 80,            // px whitespace on each side',
  '  tracking: -3,          // px added between characters',
  '  width: 210,            // mm',
  '  height: 297,           // mm',
  '',
  '  // sdf',
  `  borderWidth: ${_fmtVal(sdfDefaults.borderWidth)},     // fraction of fontSize`,
  `  bevelCurvature: ${_fmtVal(sdfDefaults.bevelCurvature)},   // 0 = flat, higher = rounder`,
  `  lightAngle: ${_fmtVal(sdfDefaults.lightAngle)},       // degrees clockwise from top (315 = upper-left)`,
  `  fillColor: ${_fmtVal(sdfDefaults.fillColor)},  // text fill`,
  `  gradientColor: ${_fmtVal(sdfDefaults.gradientColor)}, // bevel fades to this color`,
  `  shadowColor: ${_fmtVal(sdfDefaults.shadowColor)}, // shadow side of bevel`,
  `  bgColor: ${_fmtVal(sdfDefaults.bgColor)},    // background`,
  '}',
].join('\n');

let font = null;
let cssW = 0;
let cssH = 0;
let fontLoaded = false;
let renderTimer = null;
let _titleSvgImage = null; // cached HTMLImageElement once loaded
let _titleSvgRequested = false; // true while fetch is in-flight

const editorView = new EditorView({
  doc: INITIAL_CODE,
  extensions: [
    minimalSetup,
    javascript(),
    colorPickerExt,
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
  let lo = 1,
    hi = cssH * 0.5;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const lines = wrapWords(text, maxW, mid, params.tracking);
    const scale = mid / font.unitsPerEm;
    const lineH = (font.ascender - font.descender) * scale * params.leading;
    const widest = Math.max(...lines.map((l) => measureWidth(l, mid, params.tracking)));
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
    borderWidth: p.borderWidth ?? sdfDefaults.borderWidth,
    bevelCurvature: p.bevelCurvature ?? sdfDefaults.bevelCurvature,
    lightAngle: p.lightAngle ?? sdfDefaults.lightAngle,
    fillColor: typeof p.fillColor === 'string' ? p.fillColor : sdfDefaults.fillColor,
    gradientColor:
      typeof p.gradientColor === 'string' ? p.gradientColor : sdfDefaults.gradientColor,
    shadowColor: typeof p.shadowColor === 'string' ? p.shadowColor : sdfDefaults.shadowColor,
    bgColor: typeof p.bgColor === 'string' ? p.bgColor : sdfDefaults.bgColor,
  };

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = params.bgColor;
  ctx.fillRect(0, 0, cssW, cssH);

  const isA4 = Math.abs(params.width / params.height - A4) < 0.01;
  if (text === 'What You Say Is What You Get?' && isA4) {
    if (!_titleSvgImage) {
      if (!_titleSvgRequested) {
        _titleSvgRequested = true;
        const img = new Image();
        img.onload = () => {
          _titleSvgImage = img;
          _titleSvgRequested = false;
          render();
        };
        img.onerror = () => {
          _titleSvgRequested = false;
        };
        img.src = TITLE_SVG_URL;
      }
      return;
    }
    const m = params.margin;
    const svgW = cssW - m * 2;
    const svgH = (_titleSvgImage.naturalHeight / _titleSvgImage.naturalWidth) * svgW;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = cssW;
    maskCanvas.height = cssH;
    const mctx = maskCanvas.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, 0, cssW, cssH);
    mctx.drawImage(_titleSvgImage, m, m, svgW, svgH);
    renderSDF(ctx, font, canvas, {
      maskCanvas,
      lines: [],
      fontSize: 0,
      startY: 0,
      lineH: 0,
      params,
      cssW,
      cssH,
    });
    return;
  }

  const fontSize = params.fontSize > 0 ? params.fontSize : fitFontSize(text, params);
  const maxW = cssW - params.margin * 2;
  const lines = wrapWords(text, maxW, fontSize, params.tracking);

  const scale = fontSize / font.unitsPerEm;
  const lineH = (font.ascender - font.descender) * scale * params.leading;
  const firstChar = [...text].find((c) => c.trim()) || 'M';
  const topOffset = font.charToGlyph(firstChar).getBoundingBox().y2 * scale;
  const startY = params.margin + topOffset;

  renderSDF(ctx, font, canvas, { lines, fontSize, startY, lineH, params, cssW, cssH });
}

// ── Save ──────────────────────────────────────────────────────────────────────

function _slugify(str) {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'export'
  );
}

function _timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function _currentFilename() {
  const result = evaluate(editorView.state.doc.toString());
  const text = (typeof result?.text === 'string' && result.text) || 'export';
  const p = result?.params || {};
  const bw = p.borderWidth ?? sdfDefaults.borderWidth;
  const bc = p.bevelCurvature ?? sdfDefaults.bevelCurvature;
  const la = p.lightAngle ?? sdfDefaults.lightAngle;
  const fill = String(p.fillColor ?? sdfDefaults.fillColor).replace('#', '');
  const grad = String(p.gradientColor ?? sdfDefaults.gradientColor).replace('#', '');
  const bg = String(p.bgColor ?? sdfDefaults.bgColor).replace('#', '');
  const paramStr = `bw${bw} bc${bc} la${la} ${fill} ${grad} ${bg}`;
  return _slugify(text) + '-' + _slugify(paramStr);
}

function savePNG() {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _timestamp() + '-' + _currentFilename() + '.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function saveSVG() {
  const svg = window.__tools?.getSVG?.();
  if (!svg) return;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = _timestamp() + '-' + _currentFilename() + '.svg';
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('btn-save-png').addEventListener('click', savePNG);
document.getElementById('btn-save-svg').addEventListener('click', saveSVG);

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 250);
}

window.__tools = {
  editorView,
  canvas,
  ctx,
  render,
  savePNG,
  saveSVG,
  // Tools that produce vector output set this to a function returning an SVG string.
  // Setting it also enables the SVG save button automatically.
  set getSVG(fn) {
    this._getSVG = fn;
    document.getElementById('btn-save-svg').disabled = !fn;
  },
  get getSVG() {
    return this._getSVG ?? null;
  },
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

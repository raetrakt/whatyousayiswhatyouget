import { EditorView, minimalSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { parse as parseFont } from 'opentype.js';
import { colorPickerExt } from './color-picker-ext.js';

// ── Tool selection ────────────────────────────────────────────────────────────
const TOOLS = {
  sdf: () => import('./sdf/sdf.js'),
  quadtree: () => import('./quadtree/quadtree.js'),
  sand: () => import('./sand/sand.js'),
  rd: () => import('./rd/rd.js'),
};

const toolName = new URLSearchParams(location.search).get('tool') ?? 'sdf';
const tool = await (TOOLS[toolName] ?? TOOLS.sdf)();

const FONT_URL = new URL('../assets/fonts/texgyretermes-regular.otf', import.meta.url).href;
const TITLE_SVG_URL = new URL('../assets/svg/title_layout.svg', import.meta.url).href;
const A4 = 1 / Math.SQRT2;

function _fmtVal(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

const INITIAL_CODE = [
  'const text = "What You Say Is What You Get?" // type \\n for new line',
  '',
  'const params = {',
  '  fontSize: 160, // null = auto-fit',
  '  leading: .6,',
  '  margin: 25, // mm whitespace on each side',
  '  tracking: -3, // px added between characters',
  '  width: 210, // mm',
  '  height: 297, // mm',
  '  valign: "top", // top | center | bottom',
  ...tool.getParamLines(_fmtVal),
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
const errorDisplay = document.getElementById('error-display');

// ── Video recording ───────────────────────────────────────────────────────────
let _recorder = null;
let _recordingChunks = [];

// Highlight the active tool button
document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
  if (btn.dataset.tool === toolName) btn.classList.add('active');
});

function applyCanvasSize(ratio) {
  const dpr = window.devicePixelRatio || 1;
  const style = getComputedStyle(canvasPanel);
  const pw =
    canvasPanel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const ph =
    canvasPanel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (pw / ph < ratio) {
    cssW = Math.floor(pw);
    cssH = Math.floor(pw / ratio);
  } else {
    cssH = Math.floor(ph);
    cssW = Math.floor(ph * ratio);
  }
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeCanvas() {
  applyCanvasSize(A4);
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
  const lines = [];
  for (const manualLine of text.split('\n')) {
    const trimmed = manualLine.trimEnd(); // preserve leading spaces, strip trailing
    if (!trimmed || measureWidth(trimmed, fontSize, tracking) <= maxWidth) {
      lines.push(trimmed);
      continue;
    }
    // Split into alternating word-runs and space-runs to preserve spacing
    const tokens = trimmed.split(/( +)/);
    let line = '';
    for (const token of tokens) {
      const isSpace = /^ +$/.test(token);
      const candidate = line + token;
      if (line && measureWidth(candidate, fontSize, tracking) > maxWidth) {
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

function fitFontSize(text, params, w = cssW, h = cssH) {
  const maxW = w - params.margin * 2;
  const maxH = h - params.margin * 2;
  let lo = 1,
    hi = h * 0.5;
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
    return { value: fn(), error: null };
  } catch (err) {
    return { value: null, error: err.message };
  }
}

function render() {
  if (!cssW || !fontLoaded) return;
  const { value, error } = evaluate(editorView.state.doc.toString());
  if (error) {
    canvas.style.display = 'none';
    errorDisplay.textContent = error;
    errorDisplay.style.display = 'block';
    return;
  }
  canvas.style.display = '';
  errorDisplay.style.display = 'none';
  const text = (typeof value?.text === 'string' && value.text) || 'What You Say Is What You Get?';
  const p = value?.params || {};
  const params = {
    fontSize: p.fontSize ?? null,
    leading: p.leading ?? 1.2,
    margin: p.margin ?? 15,
    tracking: p.tracking ?? 0,
    width: p.width ?? 210,
    height: p.height ?? 297,
    valign: p.valign ?? 'top',
    ...tool.normalizeParams(p),
  };
  applyCanvasSize(params.width / params.height);
  // Convert margin from mm to px
  params.margin = params.margin * (cssW / params.width);

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
    let svgY;
    if (params.valign === 'bottom') {
      svgY = cssH - m - svgH;
    } else if (params.valign === 'center') {
      svgY = (cssH - svgH) / 2;
    } else {
      svgY = m;
    }
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = cssW;
    maskCanvas.height = cssH;
    const mctx = maskCanvas.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, 0, cssW, cssH);
    mctx.drawImage(_titleSvgImage, m, svgY, svgW, svgH);
    const result = tool.render(ctx, font, canvas, {
      maskCanvas,
      lines: [],
      fontSize: 0,
      startY: 0,
      lineH: 0,
      params,
      cssW,
      cssH,
    });
    if (tool.afterRender) window.__tools.getSVG = tool.afterRender(result, params, cssW, cssH);
    return;
  }

  const fontSize = params.fontSize > 0 ? params.fontSize : fitFontSize(text, params);
  const maxW = cssW - params.margin * 2;
  const lines = wrapWords(text, maxW, fontSize, params.tracking);

  const scale = fontSize / font.unitsPerEm;
  const lineH = (font.ascender - font.descender) * scale * params.leading;
  const firstChar = [...text].find((c) => c.trim()) || 'M';
  const topOffset = font.charToGlyph(firstChar).getBoundingBox().y2 * scale;
  const descenderOffset = -font.descender * scale;
  const blockH = topOffset + (lines.length - 1) * lineH + descenderOffset;
  let startY;
  if (params.valign === 'bottom') {
    startY = cssH - params.margin - blockH + topOffset;
  } else if (params.valign === 'center') {
    startY = (cssH - blockH) / 2 + topOffset;
  } else {
    startY = params.margin + topOffset;
  }

  const result = tool.render(ctx, font, canvas, {
    lines,
    fontSize,
    startY,
    lineH,
    params,
    cssW,
    cssH,
  });
  if (tool.afterRender) window.__tools.getSVG = tool.afterRender(result, params, cssW, cssH);
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
  const { value } = evaluate(editorView.state.doc.toString());
  const text = (typeof value?.text === 'string' && value.text) || 'export';
  const p = value?.params || {};
  const hint = tool.getFilenameHint ? tool.getFilenameHint(p) : toolName;
  return _slugify(text) + '-' + _slugify(hint);
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

document.getElementById('btn-reset').addEventListener('click', render);
document.getElementById('btn-save-png').addEventListener('click', savePNG);
document.getElementById('btn-save-svg').addEventListener('click', saveSVG);

// ── Record ────────────────────────────────────────────────────────────────────

function startRecording() {
  const mimeType =
    ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    ) ?? 'video/webm';
  _recordingChunks = [];
  _recorder = new MediaRecorder(canvas.captureStream(60), { mimeType });
  _recorder.ondataavailable = (e) => {
    if (e.data.size > 0) _recordingChunks.push(e.data);
  };
  _recorder.start(100);
  const btn = document.getElementById('btn-record');
  btn.textContent = 'stop';
  btn.classList.add('recording');
}

function stopRecording() {
  const recorder = _recorder;
  const chunks = _recordingChunks;
  _recorder = null;
  _recordingChunks = [];
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _timestamp() + '-' + _currentFilename() + '.webm';
    a.click();
    URL.revokeObjectURL(url);
  };
  recorder.stop();
  const btn = document.getElementById('btn-record');
  btn.textContent = 'record';
  btn.classList.remove('recording');
}

document.getElementById('btn-record').addEventListener('click', () => {
  if (_recorder) stopRecording();
  else startRecording();
});

// ── Export PNG sequence ─────────────────────────────────────────────────────

async function exportPNGSequence() {
  const exportW = parseInt(document.getElementById('export-w').value, 10);
  const exportH = parseInt(document.getElementById('export-h').value, 10);
  const exportFps = parseInt(document.getElementById('export-fps').value, 10);
  const totalFrames = parseInt(document.getElementById('export-frames').value, 10);
  if (!exportW || !exportH || !exportFps || !totalFrames) return;

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return; // cancelled
  }

  const btn = document.getElementById('btn-export');
  btn.disabled = true;

  // Offscreen canvas at export resolution (no DPR scaling — we want exact pixels)
  const offCanvas = document.createElement('canvas');
  offCanvas.width = exportW;
  offCanvas.height = exportH;
  const offCtx = offCanvas.getContext('2d');

  // Replicate the param-building logic from render()
  const { value } = evaluate(editorView.state.doc.toString());
  const text = (typeof value?.text === 'string' && value.text) || 'What You Say Is What You Get?';
  const p = value?.params || {};
  const params = {
    fontSize: p.fontSize ?? null,
    leading: p.leading ?? 1.2,
    margin: p.margin ?? 15,
    tracking: p.tracking ?? 0,
    width: p.width ?? 210,
    height: p.height ?? 297,
    valign: p.valign ?? 'top',
    ...tool.normalizeParams(p),
  };
  // Scale margin from mm to export pixels
  params.margin = params.margin * (exportW / params.width);

  // fontSize and tracking are authored in screen pixels — scale to export resolution
  const screenScale = exportW / cssW;
  if (params.fontSize > 0) params.fontSize = params.fontSize * screenScale;
  params.tracking = (params.tracking ?? 0) * screenScale;

  offCtx.clearRect(0, 0, exportW, exportH);
  offCtx.fillStyle = params.bgColor ?? '#ffffff';
  offCtx.fillRect(0, 0, exportW, exportH);

  // Build text layout at export resolution
  const fontSize =
    params.fontSize > 0 ? params.fontSize : fitFontSize(text, params, exportW, exportH);
  const maxW = exportW - params.margin * 2;
  const lines = wrapWords(text, maxW, fontSize, params.tracking);
  const scale = fontSize / font.unitsPerEm;
  const lineH = (font.ascender - font.descender) * scale * params.leading;
  const firstChar = [...text].find((c) => c.trim()) || 'M';
  const topOffset = font.charToGlyph(firstChar).getBoundingBox().y2 * scale;
  const descenderOffset = -font.descender * scale;
  const blockH = topOffset + (lines.length - 1) * lineH + descenderOffset;
  let startY;
  if (params.valign === 'bottom') startY = exportH - params.margin - blockH + topOffset;
  else if (params.valign === 'center') startY = (exportH - blockH) / 2 + topOffset;
  else startY = params.margin + topOffset;

  // Kick off the tool's animation on the offscreen canvas
  tool.render(offCtx, font, offCanvas, {
    lines,
    fontSize,
    startY,
    lineH,
    params,
    cssW: exportW,
    cssH: exportH,
  });

  // Capture frames at the target fps independently of screen rendering
  let capturedFrames = 0;
  let lastCapture = -Infinity;
  const interval = 1000 / exportFps;

  await new Promise((resolve) => {
    function loop(ts) {
      if (capturedFrames >= totalFrames) {
        resolve();
        return;
      }
      if (ts - lastCapture >= interval) {
        lastCapture = ts;
        const n = capturedFrames++;
        btn.textContent = `${capturedFrames} / ${totalFrames}`;
        offCanvas.toBlob(async (blob) => {
          const name = `frame_${String(n).padStart(5, '0')}.png`;
          const fh = await dirHandle.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        }, 'image/png');
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });

  btn.textContent = 'export';
  btn.disabled = false;
}

document.getElementById('btn-export').addEventListener('click', exportPNGSequence);

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

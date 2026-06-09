import { EditorView, minimalSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { parse as parseFont } from 'opentype.js';
import { colorPickerExt } from './color-picker-ext.js';
import { SVG_STROKE_SENTINEL } from './sand/sand.js';
import { A4, layoutText, titleUrl, titleRect, blankMask } from './title-layout.js';
import { createRecorder } from './record.js';

// ── Error line highlight (CM6 decoration) ───────────────────────────────────
const _errorLineEffect = StateEffect.define();
const _errorLineField = StateField.define({
  create: () => Decoration.none,
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(_errorLineEffect)) {
        if (e.value === null) return Decoration.none;
        try {
          const line = tr.state.doc.line(e.value);
          return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)]);
        } catch {
          return Decoration.none;
        }
      }
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Read the engine's *raw* reported line for an error thrown inside a
// `new Function` body, with no offset applied. Covers all three engines:
//   Firefox  → err.lineNumber
//   Safari   → err.line, or stack "anonymous@…:line:col"
//   V8/Chrome→ stack "<anonymous>:line:col"
function _rawErrLine(err) {
  if (typeof err.lineNumber === 'number') return err.lineNumber; // Firefox
  if (typeof err.line === 'number') return err.line; // Safari
  const stack = String(err.stack ?? '');
  let m = stack.match(/<anonymous>:(\d+):\d+/); // V8
  if (m) return parseInt(m[1]);
  m = stack.match(/@.*?:(\d+):\d+/); // Safari/JSC fallback
  return m ? parseInt(m[1]) : null;
}

// Each engine wraps a `new Function` body in its own header (e.g. V8 prepends
// `function anonymous(animate\n) {`), so the reported line is shifted by a
// constant. Rather than hardcode a per-engine guess, calibrate it once by
// throwing a probe error on code-line 1 and measuring the reported line.
// The probe mirrors evaluate()'s template exactly so the offset matches.
let _errLineOffset = 3; // fallback if calibration fails
(function _calibrateErrorOffset() {
  try {
    const fn = new Function(
      'animate',
      `
      throw new Error('probe');
      return { text: null, params: null }
    `,
    );
    fn();
  } catch (err) {
    const reported = _rawErrLine(err);
    if (reported != null) _errLineOffset = reported - 1; // throw sits on code-line 1
  }
})();

function _parseErrLine(err) {
  const raw = _rawErrLine(err);
  return raw != null ? raw - _errLineOffset : null;
}

// ── Tool selection ────────────────────────────────────────────────────────────
const TOOLS = {
  sdf: () => import('./sdf/sdf.js'),
  quadtree: () => import('./quadtree/quadtree.js'),
  sand: () => import('./sand/sand.js'),
  rd: () => import('./rd/rd.js'),
  resampling: () => import('./resampling/resampling.js'),
};

// Teardown for the currently-mounted tool/editor instance. The canvas, button
// listeners and tool animation loops are all shared/persistent, so before
// mounting a new tool we must dispose the previous one — otherwise its
// requestAnimationFrame loop keeps drawing onto the shared canvas (e.g. after
// navigating back to the overview via the browser and picking another tool).
let _activeCleanup = null;

async function initEditor(toolName) {
  // Dispose the previously-mounted tool instance before swapping the DOM.
  _activeCleanup?.();
  _activeCleanup = null;

  // Switch to editor immediately, before the async tool import
  document.getElementById('overview').hidden = true;
  document.getElementById('app').hidden = false;
  document.getElementById('bottom-bar').hidden = false;

  // Remove any editor instance left over from a previous tool.
  document.getElementById('editor').replaceChildren();

  const tool = await (TOOLS[toolName] ?? TOOLS.sdf)();

  const FONT_URL = new URL('../assets/fonts/texgyretermes-regular.otf', import.meta.url).href;

  function _fmtVal(v) {
    return typeof v === 'string' ? JSON.stringify(v) : String(v);
  }

  const INITIAL_CODE = [
    '// This is part of the code that creates the image',
    '// Try changing the values and see what happens',
    '// https://github.com/raetrakt/whatyousayiswhatyouget',
    '',
    'const text = "What You Say Is What You Get?"',
    '',
    'const params = {',
    '  fontSize: null, // null = auto-fit',
    '  leading: .6, // space between lines',
    '  tracking: -3, // px added between chars',
    '  margin: 25, // whitespace on each side',
    '  width: 210,',
    '  height: 297,',
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
  let _titleSvgImageSrc = null; // URL of currently cached title image
  let _titleSvgText = null; // raw SVG source text for stroke injection
  let _titleSvgTextRequested = false;
  let _titleSvgStrokedImage = null; // stroked version of title SVG
  let _titleSvgStrokedKey = null; // '<strokeColor>|<strokeWidth>|<svgW>' cache key
  let _titleSvgStrokedRequested = false;

  const editorView = new EditorView({
    doc: INITIAL_CODE,
    extensions: [
      minimalSetup,
      javascript(),
      colorPickerExt,
      _errorLineField,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) scheduleRender();
      }),
    ],
    parent: document.getElementById('editor'),
  });
  editorView.focus();
  const _textLine = editorView.state.doc.toString().indexOf('const text = ');
  if (_textLine !== -1) {
    const _lineEnd = editorView.state.doc.toString().indexOf('\n', _textLine);
    editorView.dispatch({
      selection: { anchor: _lineEnd === -1 ? editorView.state.doc.length : _lineEnd - 1 },
    });
  }

  const canvas = document.getElementById('sketch');
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  const canvasPanel = document.getElementById('canvas-panel');
  const errorDisplay = document.getElementById('error-display');

  // ── Video recording ───────────────────────────────────────────────────────────
  // Recording logic lives in ./record.js; it's wired up after the canvas and
  // filename helpers are available (see createRecorder call below).

  // Highlight the active tool button
  document.querySelectorAll('.tool-switch-link[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
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

  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(canvasPanel);

  function drawLine(line, x, y, fontSize, tracking) {
    const scale = fontSize / font.unitsPerEm;
    const chars = [...line];
    const glyphs = chars.map((ch) => font.charToGlyph(ch));
    let cx = x;
    for (let i = 0; i < glyphs.length; i++) {
      font.draw(ctx, chars[i], cx, y, fontSize);
      const kern =
        i < glyphs.length - 1 ? font.getKerningValue(glyphs[i], glyphs[i + 1]) * scale : 0;
      cx += glyphs[i].advanceWidth * scale + tracking + kern;
    }
  }

  function evaluate(code, animateHook) {
    try {
      const fn = new Function(
        'animate',
        `
      ${code}
      return {
        text: typeof text !== 'undefined' ? text : null,
        params: typeof params !== 'undefined' ? params : null,
      }
    `,
      );
      return { value: fn(animateHook), error: null, errorLine: null };
    } catch (err) {
      return { value: null, error: err.message, errorLine: _parseErrLine(err) };
    }
  }

  // ── Animation loop ─────────────────────────────────────────────────────────────
  let _animateFn = null;
  let _animateFrame = 0;
  let _animateRafId = null;
  let _animateBaseValue = null;

  function _stopAnimation() {
    if (_animateRafId) cancelAnimationFrame(_animateRafId);
    _animateRafId = null;
    _animateFn = null;
    _animateFrame = 0;
    _animateBaseValue = null;
  }

  function _animationLoop() {
    if (!_animateFn || !_animateBaseValue) return;
    const overrides = _animateFn(_animateFrame++) ?? {};
    _renderWithValue(_animateBaseValue, overrides);
    _animateRafId = requestAnimationFrame(_animationLoop);
  }

  function render() {
    if (!cssW || !fontLoaded) return;
    let _newAnimateFn = null;
    const animateHook = (fn) => {
      _newAnimateFn = fn;
    };
    const { value, error, errorLine } = evaluate(editorView.state.doc.toString(), animateHook);
    if (error) {
      _stopAnimation();
      canvas.style.display = 'none';
      const lineHint = errorLine != null ? `Line ${errorLine}: ` : '';
      errorDisplay.textContent = lineHint + error;
      errorDisplay.style.display = 'block';
      editorView.dispatch({ effects: _errorLineEffect.of(errorLine) });
      return;
    }
    canvas.style.display = '';
    errorDisplay.style.display = 'none';
    editorView.dispatch({ effects: _errorLineEffect.of(null) });

    if (_newAnimateFn) {
      if (_animateRafId) cancelAnimationFrame(_animateRafId);
      _animateFn = _newAnimateFn;
      _animateFrame = 0;
      _animateBaseValue = value;
      _animateRafId = requestAnimationFrame(_animationLoop);
    } else {
      _stopAnimation();
      _renderWithValue(value, {});
    }
  }

  function _renderWithValue(value, overrides) {
    const text = (typeof value?.text === 'string' && value.text) || 'What You Say Is What You Get?';
    const p = { ...(value?.params || {}), ...overrides };
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

    const isDefaultTitle = text === 'What You Say Is What You Get?';
    const isDefaultParams =
      (p.fontSize === undefined || p.fontSize === null) &&
      (p.leading === undefined || p.leading === 0.6) &&
      (p.tracking === undefined || p.tracking === -3) &&
      // (p.margin === undefined || p.margin === 25) &&
      (p.width === undefined || p.width === 210) &&
      (p.height === undefined || p.height === 297) &&
      (p.valign === undefined || p.valign === 'top');
    const selectedTitleSvgUrl = titleUrl(params);
    const collapseDelay = params.collapseDelay ?? 0;
    if (isDefaultTitle && isDefaultParams && selectedTitleSvgUrl && collapseDelay === 0) {
      // Reset cache when switching between title assets.
      if (_titleSvgImageSrc !== selectedTitleSvgUrl) {
        _titleSvgImage = null;
        _titleSvgRequested = false;
        _titleSvgImageSrc = selectedTitleSvgUrl;
        _titleSvgText = null;
        _titleSvgTextRequested = false;
        _titleSvgStrokedImage = null;
        _titleSvgStrokedKey = null;
      }

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
          img.src = selectedTitleSvgUrl;
        }
        return;
      }
      const m = params.margin;
      const { y: svgY, w: svgW, h: svgH } = titleRect(_titleSvgImage, params, cssW, cssH);
      const maskCanvas = blankMask(cssW, cssH);
      const mctx = maskCanvas.getContext('2d');

      const _strokeColor = params.strokeColor ?? null;
      const _strokeWidth = params.strokeWidth ?? 0;
      if (_strokeColor && _strokeWidth > 0) {
        const strokedKey = `${_strokeColor}|${_strokeWidth}|${svgW}`;
        if (_titleSvgStrokedKey !== strokedKey) {
          _titleSvgStrokedImage = null;
          _titleSvgStrokedKey = null;
        }
        if (!_titleSvgStrokedImage) {
          if (!_titleSvgText) {
            if (!_titleSvgTextRequested) {
              _titleSvgTextRequested = true;
              fetch(selectedTitleSvgUrl)
                .then((r) => r.text())
                .then((text) => {
                  _titleSvgText = text;
                  _titleSvgTextRequested = false;
                  render();
                })
                .catch(() => {
                  _titleSvgTextRequested = false;
                });
            }
          } else if (!_titleSvgStrokedRequested) {
            _titleSvgStrokedRequested = true;
            const nw = _titleSvgImage.naturalWidth || 300;
            const strokedSvg = _injectSvgStroke(
              _titleSvgText,
              _strokeColor,
              _strokeWidth,
              nw,
              svgW,
            );
            const blob = new Blob([strokedSvg], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
              _titleSvgStrokedImage = img;
              _titleSvgStrokedKey = strokedKey;
              _titleSvgStrokedRequested = false;
              URL.revokeObjectURL(url);
              render();
            };
            img.onerror = () => {
              _titleSvgStrokedRequested = false;
              URL.revokeObjectURL(url);
            };
            img.src = url;
          }
          // Fall back to plain image while stroked version is loading
          mctx.drawImage(_titleSvgImage, m, svgY, svgW, svgH);
        } else {
          mctx.drawImage(_titleSvgStrokedImage, m, svgY, svgW, svgH);
        }
      } else {
        mctx.drawImage(_titleSvgImage, m, svgY, svgW, svgH);
      }
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

    const { lines, fontSize, startY, lineH } = layoutText(font, text, params, cssW, cssH);

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
  function _injectSvgStroke(svgText, strokeColor, strokeWidth, naturalWidth, svgW) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;

    // stroke-width in SVG user units (centred stroke, so outer half = strokeWidth)
    const svgSW = 2 * strokeWidth * (naturalWidth / svgW);
    const expansion = svgSW / 2;

    // Expand viewBox so the outside stroke isn't clipped
    const vb = root.getAttribute('viewBox');
    if (vb) {
      const [vx, vy, vw, vh] = vb
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      root.setAttribute(
        'viewBox',
        `${vx - expansion} ${vy - expansion} ${vw + expansion * 2} ${vh + expansion * 2}`,
      );
    }

    // Collect all non-style child nodes to clone into two layers
    const visibleChildren = [...root.childNodes].filter(
      (n) => n.nodeType === 1 && n.nodeName.toLowerCase() !== 'style',
    );

    // ── Layer 1 (bottom): sentinel stroke only — no fill ─────────────────────
    // Drawing all strokes first guarantees no stroke ever paints over another
    // letter's fill in the final raster.
    const strokeGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    strokeGroup.setAttribute('class', 'sand-s');
    for (const child of visibleChildren) strokeGroup.appendChild(child.cloneNode(true));

    // ── Layer 2 (top): fill only ──────────────────────────────────────────────
    const fillGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    fillGroup.setAttribute('class', 'sand-f');
    for (const child of visibleChildren) fillGroup.appendChild(child.cloneNode(true));

    // Remove original elements, replace with the two groups
    for (const child of visibleChildren) root.removeChild(child);
    root.appendChild(strokeGroup);
    root.appendChild(fillGroup);

    // CSS for each layer (appended last so it wins over any SVG-internal styles)
    const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent =
      `.sand-s path,.sand-s rect,.sand-s circle,.sand-s ellipse,` +
      `.sand-s polyline,.sand-s polygon,.sand-s line,.sand-s text {` +
      ` fill: none; stroke: ${SVG_STROKE_SENTINEL}; stroke-width: ${svgSW}; }` +
      `.sand-f path,.sand-f rect,.sand-f circle,.sand-f ellipse,` +
      `.sand-f polyline,.sand-f polygon,.sand-f line,.sand-f text {` +
      ` fill: #000; stroke: none; }`;
    root.appendChild(style);

    return new XMLSerializer().serializeToString(doc);
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

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 's') {
      e.preventDefault();
      savePNG();
    }
  });

  // ── Record ────────────────────────────────────────────────────────────────────

  createRecorder({
    canvas,
    errorDisplay,
    button: document.getElementById('btn-record'),
    getFilename: () => _timestamp() + '-' + _currentFilename(),
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
    const offCtx = offCanvas.getContext('2d', { colorSpace: 'srgb' });

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
    const { lines, fontSize, startY, lineH } = layoutText(font, text, params, exportW, exportH);

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

  // document.getElementById('btn-export').addEventListener('click', exportPNGSequence);

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 250);
  }

  // ── Scroll accumulator ────────────────────────────────────────────────────────
  let _wheelValue = 1;
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      _wheelValue = Math.max(0.01, _wheelValue - e.deltaY * 0.01);
    },
    { passive: false },
  );

  window.__tools = {
    editorView,
    canvas,
    ctx,
    render,
    savePNG,
    saveSVG,
    get wheel() {
      return _wheelValue;
    },
    set wheel(v) {
      _wheelValue = v;
    },
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

  // Register teardown so the next tool (or a return to the overview) can stop
  // this instance's loops/observers before mounting on the shared canvas.
  _activeCleanup = () => {
    resizeObserver.disconnect();
    clearTimeout(renderTimer);
    _stopAnimation();
    tool.stop?.();
  };

  init().catch((err) => console.error('Init failed:', err));
} // end initEditor

// ── SPA navigation ────────────────────────────────────────────────────────────
const toolParam = new URLSearchParams(location.search).get('tool');

if (toolParam) {
  await initEditor(toolParam);
} else {
  document.querySelectorAll('.tool-card').forEach((card) => {
    card.addEventListener('click', async (e) => {
      e.preventDefault();
      const name = new URL(card.href, location.href).searchParams.get('tool');
      history.pushState(null, '', card.href);
      await initEditor(name);
    });
  });
}

window.addEventListener('popstate', () => {
  const param = new URLSearchParams(location.search).get('tool');
  if (!param) {
    _activeCleanup?.();
    _activeCleanup = null;
    document
      .querySelectorAll('.tool-switch-link.active')
      .forEach((btn) => btn.classList.remove('active'));
    document.getElementById('overview').hidden = false;
    document.getElementById('app').hidden = true;
    document.getElementById('bottom-bar').hidden = true;
  }
});

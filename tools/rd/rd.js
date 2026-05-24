// Reaction-diffusion (Gray-Scott model) text simulation.
// Text pixels seed the V chemical; organic patterns grow outward from the letters.
//
// Gray-Scott equations:
//   dU/dt = Du·∇²U  −  U·V²  +  F·(1−U)
//   dV/dt = Dv·∇²V  +  U·V²  −  (F+k)·V
//
// Good starting points:
//   feed 0.055  kill 0.062  → moving spots
//   feed 0.037  kill 0.060  → static spots / cells
//   feed 0.025  kill 0.050  → spiral waves
//   feed 0.039  kill 0.058  → labyrinthine stripes

export const defaults = {
  feed: 0.055, // feed rate of U (0.01–0.08)
  kill: 0.062, // kill rate of V (0.04–0.07)
  speed: 8, // simulation steps per frame
  scale: 2, // grid resolution divisor (higher = faster but coarser)
  thresh: false, // snap to solid fill/bg colors instead of smooth gradient
  threshVal: 0.2, // V cutoff when thresh is true (0–1, try 0.1–0.3)
  sharpen: true, // sharpen V values before colorizing (only when thresh is false)
  brushMode: false, // paint to seed reaction; type stays stable
  brushRadius: 30, // brush size in CSS px
  colorHigh: '#000000', // high-V color
  colorLow:  '#ffffff', // low-V color
  bgColor:   '#ffffff', // canvas background (separate from gradient)
};

// Version counter cancels stale animation loops on re-render.
let _version = 0;
let _rdBrushMode = false;
let _rdBrushRadius = 30;
let _rdSeedFn = null; // set each render; called by listener with CSS coords

/**
 * render(ctx, font, canvas, layout)
 *
 * ctx     — the main canvas 2D context (DPR transform already applied)
 * font    — opentype.js Font object
 * canvas  — the main HTMLCanvasElement
 * layout  — { lines, fontSize, startY, lineH, params, cssW, cssH, maskCanvas }
 */
export function render(
  ctx,
  font,
  canvas,
  { lines, fontSize, startY, lineH, params, cssW, cssH, maskCanvas },
) {
  const version = ++_version;

  const F = params.feed ?? defaults.feed;
  const k = params.kill ?? defaults.kill;
  const stepsPerFrame = Math.max(1, Math.round(params.speed ?? defaults.speed));
  const sc = Math.max(1, Math.round(params.scale ?? defaults.scale));
  const thresh    = params.thresh    ?? defaults.thresh;
  const threshVal = params.threshVal ?? defaults.threshVal;
  const sharpen   = params.sharpen   ?? defaults.sharpen;
  const fillColor = params.colorHigh ?? defaults.colorHigh;
  const bgColor   = params.colorLow  ?? defaults.colorLow;
  const canvasBg  = params.bgColor   ?? defaults.bgColor;
  const brushMode = params.brushMode ?? defaults.brushMode;
  const brushRadius = params.brushRadius ?? defaults.brushRadius;

  // Sync module-level brush state for the persistent listener.
  _rdBrushMode = brushMode;
  _rdBrushRadius = brushRadius;
  canvas.style.cursor = brushMode ? 'none' : '';
  if (canvas.__rdIndicator) canvas.__rdIndicator.style.display = 'none';

  // Simulation grid dimensions (smaller than canvas for performance).
  const gW = Math.max(4, Math.floor(cssW / sc));
  const gH = Math.max(4, Math.floor(cssH / sc));
  const n = gW * gH;

  // ── 1. Rasterize text at full CSS size, then downscale to grid ─────────────
  const textCanvas = document.createElement('canvas');
  textCanvas.width = cssW;
  textCanvas.height = cssH;
  const tctx = textCanvas.getContext('2d');
  tctx.fillStyle = '#fff';
  tctx.fillRect(0, 0, cssW, cssH);

  if (maskCanvas) {
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(maskCanvas, 0, 0, cssW, cssH);
  } else {
    _drawGlyphs(tctx, font, lines, fontSize, startY, lineH, params, cssW, '#000');
  }

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = gW;
  gridCanvas.height = gH;
  const gctx = gridCanvas.getContext('2d');
  gctx.imageSmoothingEnabled = true;
  gctx.imageSmoothingQuality = 'high';
  gctx.drawImage(textCanvas, 0, 0, gW, gH);
  const pxData = gctx.getImageData(0, 0, gW, gH).data;

  // ── 2. Initialize U and V ping-pong buffers ────────────────────────────────
  // Steady state outside text: U=1, V=0.
  // Text pixels seed the reaction: U=0.5, V=0.25 + small noise.
  let uA = new Float32Array(n).fill(1);
  let vA = new Float32Array(n); // zero
  let uB = new Float32Array(n);
  let vB = new Float32Array(n);

  // Build text mask; seed text pixels only in normal (non-brush) mode.
  const textMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (pxData[i * 4] < 128) {
      textMask[i] = 1;
      if (!brushMode) {
        uA[i] = 0.5 + (Math.random() - 0.5) * 0.1;
        vA[i] = 0.25 + Math.random() * 0.05;
      }
    }
  }

  // Seed function — called by brush listeners with CSS-space coordinates.
  _rdSeedFn = brushMode
    ? (cssX, cssY) => {
        const gx = Math.round(cssX / sc);
        const gy = Math.round(cssY / sc);
        const gr = Math.max(1, Math.round(brushRadius / sc));
        const gr2 = gr * gr;
        for (let y = Math.max(0, gy - gr); y <= Math.min(gH - 1, gy + gr); y++) {
          for (let x = Math.max(0, gx - gr); x <= Math.min(gW - 1, gx + gr); x++) {
            if ((x - gx) ** 2 + (y - gy) ** 2 <= gr2) {
              uA[y * gW + x] = 0.5;
              vA[y * gW + x] = 0.25;
            }
          }
        }
      }
    : null;

  // ── 3. Diffusion rates (standard Gray-Scott, Du:Dv = 2:1) ─────────────────
  const Du = 0.2097;
  const Dv = 0.105;

  // ── 4. Single simulation step (4-neighbour Laplacian, clamped edges) ───────
  function stepOnce() {
    for (let y = 0; y < gH; y++) {
      const ym = y > 0 ? y - 1 : 0;
      const yp = y < gH - 1 ? y + 1 : gH - 1;
      const row = y * gW;
      const rowM = ym * gW;
      const rowP = yp * gW;

      for (let x = 0; x < gW; x++) {
        const i = row + x;
        const xm = x > 0 ? x - 1 : 0;
        const xp = x < gW - 1 ? x + 1 : gW - 1;

        const uv = uA[i];
        const vv = vA[i];

        const lapU = uA[rowM + x] + uA[rowP + x] + uA[row + xm] + uA[row + xp] - 4 * uv;
        const lapV = vA[rowM + x] + vA[rowP + x] + vA[row + xm] + vA[row + xp] - 4 * vv;

        const uvv = uv * vv * vv;
        uB[i] = Math.max(0, Math.min(1, uv + Du * lapU - uvv + F * (1 - uv)));
        vB[i] = Math.max(0, Math.min(1, vv + Dv * lapV + uvv - (F + k) * vv));
      }
    }
    // Swap ping-pong buffers.
    const tu = uA;
    uA = uB;
    uB = tu;
    const tv = vA;
    vA = vB;
    vB = tv;
  }

  // ── 5. Frame canvas for blitting ──────────────────────────────────────────
  const [fr, fg, fb] = _hexToRgb(fillColor);
  const [br, bg2, bb] = _hexToRgb(bgColor);

  const frame = document.createElement('canvas');
  frame.width = gW;
  frame.height = gH;
  const fctx = frame.getContext('2d');
  const frameData = fctx.createImageData(gW, gH);
  const fd = frameData.data;
  let vSharp = null; // lazily allocated sharpen buffer

  // ── 6. Animation loop ──────────────────────────────────────────────────────
  function loop() {
    if (_version !== version) return; // stale render — stop

    for (let s = 0; s < stepsPerFrame; s++) {
      stepOnce();
      // In brush mode, pin text pixels to steady state so letters stay stable.
      if (brushMode) {
        for (let i = 0; i < n; i++) {
          if (textMask[i]) {
            uA[i] = 1;
            vA[i] = 0;
          }
        }
      }
    }

    // Map V → color.
    let vSrc = vA;
    if (!thresh && sharpen) {
      if (!vSharp) vSharp = new Float32Array(n);
      for (let y = 0; y < gH; y++) {
        const ym = y > 0 ? y - 1 : 0;
        const yp = y < gH - 1 ? y + 1 : gH - 1;
        for (let x = 0; x < gW; x++) {
          const xm = x > 0 ? x - 1 : 0;
          const xp = x < gW - 1 ? x + 1 : gW - 1;
          const i  = y * gW + x;
          const lap = vA[ym * gW + x] + vA[yp * gW + x] + vA[y * gW + xm] + vA[y * gW + xp];
          vSharp[i] = Math.max(0, Math.min(1, 5 * vA[i] - lap));
        }
      }
      vSrc = vSharp;
    }
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      if (brushMode && textMask[i]) {
        // Overlay text as solid colorHigh regardless of simulation state.
        fd[j] = fr; fd[j + 1] = fg; fd[j + 2] = fb; fd[j + 3] = 255;
      } else if (thresh) {
        const on = vSrc[i] >= threshVal;
        // Off pixels are transparent — bgColor shows through underneath.
        fd[j] = on ? fr : 0;
        fd[j + 1] = on ? fg : 0;
        fd[j + 2] = on ? fb : 0;
        fd[j + 3] = on ? 255 : 0;
      } else {
        const v = vSrc[i];
        if (v < 0.01) {
          // True background — transparent so bgColor shows through.
          fd[j] = 0; fd[j + 1] = 0; fd[j + 2] = 0; fd[j + 3] = 0;
        } else {
          const t = Math.min(1, v * 2.5);
          fd[j]     = Math.round(br + (fr - br) * t);
          fd[j + 1] = Math.round(bg2 + (fg - bg2) * t);
          fd[j + 2] = Math.round(bb + (fb - bb) * t);
          fd[j + 3] = 255;
        }
      }
    }
    fctx.putImageData(frameData, 0, 0);

    // Fill canvas with bgColor, then composite transparent RD frame on top.
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, cssW, cssH);
    // imageSmoothingEnabled = false gives a pixelated look at scale > 1.
    ctx.imageSmoothingEnabled = sc === 1;
    ctx.drawImage(frame, 0, 0, cssW, cssH);

    requestAnimationFrame(loop);
  }

  if (brushMode) _setupRDBrushListeners(canvas);
  loop();
}

// ─── RD Brush helpers ────────────────────────────────────────────────────────

function _setupRDBrushListeners(canvas) {
  if (canvas.__rdBrushAttached) return;
  canvas.__rdBrushAttached = true;

  const indicator = document.createElement('div');
  indicator.style.cssText = [
    'position:fixed',
    'display:none',
    'pointer-events:none',
    'border-radius:50%',
    'border:1.5px solid #000',
    'outline:1px solid #fff',
    'box-sizing:border-box',
    'transform:translate(-50%,-50%)',
  ].join(';');
  document.body.appendChild(indicator);
  canvas.__rdIndicator = indicator;

  let painting = false;

  function moveIndicator(e) {
    if (!_rdBrushMode) return;
    const d = _rdBrushRadius * 2;
    indicator.style.width = `${d}px`;
    indicator.style.height = `${d}px`;
    indicator.style.left = `${e.clientX}px`;
    indicator.style.top = `${e.clientY}px`;
    indicator.style.display = 'block';
  }

  canvas.addEventListener('mouseenter', moveIndicator);
  canvas.addEventListener('mousemove', (e) => {
    moveIndicator(e);
    if (!_rdBrushMode || !painting) return;
    if (_rdSeedFn) _rdSeedFn(e.offsetX, e.offsetY);
  });
  canvas.addEventListener('mouseleave', () => {
    painting = false;
    indicator.style.display = 'none';
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!_rdBrushMode) return;
    painting = true;
    if (_rdSeedFn) _rdSeedFn(e.offsetX, e.offsetY);
  });
  canvas.addEventListener('mouseup', () => {
    painting = false;
  });
}

// ─── Glyph rendering helpers ──────────────────────────────────────────────────

function _drawGlyphs(rctx, font, lines, fontSize, startY, lineH, params, cssW, color) {
  const scale = fontSize / font.unitsPerEm;
  for (let i = 0; i < lines.length; i++) {
    let cx = _lineStartX(lines[i], fontSize, params, font, cssW);
    const y = startY + i * lineH;
    const chars = [...lines[i]];
    const gs = chars.map((ch) => font.charToGlyph(ch));
    for (let j = 0; j < gs.length; j++) {
      const p = font.getPath(chars[j], cx, y, fontSize);
      p.fill = color;
      p.draw(rctx);
      const kern = j < gs.length - 1 ? font.getKerningValue(gs[j], gs[j + 1]) * scale : 0;
      cx += gs[j].advanceWidth * scale + (params.tracking || 0) + kern;
    }
  }
}

function _lineStartX(line, fontSize, params, font, cssW) {
  const scale = fontSize / font.unitsPerEm;
  const chars = [...line];
  const gs = chars.map((ch) => font.charToGlyph(ch));
  let w = 0;
  for (let i = 0; i < gs.length; i++) {
    w += gs[i].advanceWidth * scale + (params.tracking || 0);
    if (i < gs.length - 1) w += font.getKerningValue(gs[i], gs[i + 1]) * scale;
  }
  return (cssW - (w - (params.tracking || 0))) / 2;
}

function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ─── Tool interface ────────────────────────────────────────────────────────────

export function getParamLines(fmtVal) {
  return [
    '',
    '  // rd — Gray-Scott reaction diffusion',
    '  //   spots:    feed 0.055  kill 0.062',
    '  //   cells:    feed 0.037  kill 0.060',
    '  //   spirals:  feed 0.025  kill 0.050',
    '  //   stripes:  feed 0.039  kill 0.058',
    `  feed: ${fmtVal(defaults.feed)},           // feed rate of U`,
    `  kill: ${fmtVal(defaults.kill)},           // kill rate of V`,
    `  speed: ${fmtVal(defaults.speed)},            // steps per frame`,
    `  scale: ${fmtVal(defaults.scale)},            // grid resolution divisor`,
    `  thresh: ${fmtVal(defaults.thresh)},         // snap to solid colors`,
    `  threshVal: ${fmtVal(defaults.threshVal)},       // V cutoff (0–1)`,
    `  sharpen: ${fmtVal(defaults.sharpen)},          // sharpen when thresh is off`,
    `  brushMode: ${fmtVal(defaults.brushMode)},      // paint to seed reaction; type stays stable`,
    `  brushRadius: ${fmtVal(defaults.brushRadius)},       // brush size (CSS px)`,
    `  colorHigh: ${fmtVal(defaults.colorHigh)},  // high-V color`,
    `  colorLow:  ${fmtVal(defaults.colorLow)},  // low-V color`,
    `  bgColor:   ${fmtVal(defaults.bgColor)},  // canvas background`,
  ];
}

export function normalizeParams(p) {
  return {
    feed: p.feed ?? defaults.feed,
    kill: p.kill ?? defaults.kill,
    speed: p.speed ?? defaults.speed,
    scale: p.scale ?? defaults.scale,
    thresh: p.thresh ?? defaults.thresh,
    threshVal: p.threshVal ?? defaults.threshVal,
    sharpen:   p.sharpen   ?? defaults.sharpen,
    brushMode: p.brushMode ?? defaults.brushMode,
    brushRadius: p.brushRadius ?? defaults.brushRadius,
    colorHigh: typeof p.colorHigh === 'string' ? p.colorHigh : defaults.colorHigh,
    colorLow:  typeof p.colorLow  === 'string' ? p.colorLow  : defaults.colorLow,
    bgColor:   typeof p.bgColor   === 'string' ? p.bgColor   : defaults.bgColor,
  };
}

export function getFilenameHint(p) {
  const feed = p.feed ?? defaults.feed;
  const kill = p.kill ?? defaults.kill;
  const high = String(p.colorHigh ?? defaults.colorHigh).replace('#', '');
  const low  = String(p.colorLow  ?? defaults.colorLow).replace('#', '');
  return `rd f${feed} k${kill} ${high}-${low}`;
}

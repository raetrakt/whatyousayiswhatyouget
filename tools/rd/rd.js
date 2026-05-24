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
  // simulation
  feed: 0.055, // feed rate of U (0.01–0.08)
  kill: 0.062, // kill rate of V (0.04–0.07)
  speed: 8, // steps per animation frame
  scale: 2, // simulation grid divisor — controls pattern thickness
  renderScale: 1, // render output divisor — 1 = full quality, 2 = half res
  // appearance
  thresh: false, // snap to solid colors instead of smooth gradient
  threshVal: 0.2, // V cutoff for solid mode (0–1)
  colorHigh: '#000000', // color at dense areas (high V)
  colorLow: '#002aff', // color at sparse areas (low V)
  lowPos: 50, // where colorLow sits in brightness (0 = hard edge, 128 = halfway)
  hardCut: true, // true = sharp edge at lowPos; false = fade to transparent
  bgColor: '#ffffff', // canvas background
  // brush
  brushMode: false, // paint to seed reaction; letters stay stable
  brushRadius: 30, // brush size in CSS px
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
  const renderSc = Math.max(1, Math.round(params.renderScale ?? defaults.renderScale));
  const thresh = params.thresh ?? defaults.thresh;
  const threshVal = params.threshVal ?? defaults.threshVal;
  const lowPos = params.lowPos ?? defaults.lowPos;
  const hardCut = params.hardCut ?? defaults.hardCut;
  const fillColor = params.colorHigh ?? defaults.colorHigh;
  const bgColor = params.colorLow ?? defaults.colorLow;
  const canvasBg = params.bgColor ?? defaults.bgColor;
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

  const fW = Math.max(4, Math.floor(cssW / renderSc));
  const fH = Math.max(4, Math.floor(cssH / renderSc));
  const fn = fW * fH;
  const needsInterp = fW !== gW || fH !== gH;

  const frame = document.createElement('canvas');
  frame.width = fW;
  frame.height = fH;
  const fctx = frame.getContext('2d');
  const frameData = fctx.createImageData(fW, fH);
  const fd = frameData.data;

  // ── 5b. Text mask at frame resolution (brush mode) ────────────────────────
  // Downscale full-res textCanvas to frame size for a crisp glyph boundary.
  const textAlphaFrame = new Float32Array(fn);
  if (brushMode) {
    const ftc = document.createElement('canvas');
    ftc.width = fW;
    ftc.height = fH;
    const ftctx = ftc.getContext('2d');
    ftctx.imageSmoothingEnabled = true;
    ftctx.imageSmoothingQuality = 'high';
    ftctx.drawImage(textCanvas, 0, 0, fW, fH);
    const ftd = ftctx.getImageData(0, 0, fW, fH).data;
    for (let i = 0; i < fn; i++) {
      textAlphaFrame[i] = 1 - ftd[i * 4] / 255;
    }
  }

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
    const vSrc = vA;

    // Precompute brightness thresholds (V maps to t = clamp(v*2.5, 0, 1)).
    const tLow = lowPos / 255;

    for (let i = 0; i < fn; i++) {
      const j = i * 4;

      // Resolve V for this frame pixel (bilinear if sim grid ≠ frame size).
      let v;
      if (needsInterp) {
        const fx = i % fW;
        const fy = Math.floor(i / fW);
        const gxf = ((fx + 0.5) * gW) / fW - 0.5;
        const gyf = ((fy + 0.5) * gH) / fH - 0.5;
        const gx0 = Math.max(0, Math.floor(gxf));
        const gy0 = Math.max(0, Math.floor(gyf));
        const gx1 = Math.min(gx0 + 1, gW - 1);
        const gy1 = Math.min(gy0 + 1, gH - 1);
        const tx = gxf - gx0;
        const ty = gyf - gy0;
        if (brushMode) {
          // In brush mode, text sim-pixels are pinned to V=0. Exclude them
          // from bilinear weights so they don't contaminate neighbouring frame
          // pixels with artificially low V.
          const w00 = textMask[gy0 * gW + gx0] ? 0 : (1 - tx) * (1 - ty);
          const w10 = textMask[gy0 * gW + gx1] ? 0 : tx * (1 - ty);
          const w01 = textMask[gy1 * gW + gx0] ? 0 : (1 - tx) * ty;
          const w11 = textMask[gy1 * gW + gx1] ? 0 : tx * ty;
          const wSum = w00 + w10 + w01 + w11;
          v =
            wSum > 0
              ? (vSrc[gy0 * gW + gx0] * w00 +
                  vSrc[gy0 * gW + gx1] * w10 +
                  vSrc[gy1 * gW + gx0] * w01 +
                  vSrc[gy1 * gW + gx1] * w11) /
                wSum
              : 0;
        } else {
          v =
            vSrc[gy0 * gW + gx0] * (1 - tx) * (1 - ty) +
            vSrc[gy0 * gW + gx1] * tx * (1 - ty) +
            vSrc[gy1 * gW + gx0] * (1 - tx) * ty +
            vSrc[gy1 * gW + gx1] * tx * ty;
        }
      } else {
        v = vSrc[i];
      }

      // Compute simulation color from V.
      let r, g, b, a;
      if (thresh) {
        const on = v >= threshVal;
        r = on ? fr : 0;
        g = on ? fg : 0;
        b = on ? fb : 0;
        a = on ? 255 : 0;
      } else {
        const t = Math.min(1, v * 2.5);
        if (tLow > 0 && t < tLow) {
          r = br;
          g = bg2;
          b = bb;
        } else {
          const s = tLow < 1 ? (tLow > 0 ? (t - tLow) / (1 - tLow) : t) : 1;
          const sc2 = Math.max(0, Math.min(1, s));
          r = Math.round(br + (fr - br) * sc2);
          g = Math.round(bg2 + (fg - bg2) * sc2);
          b = Math.round(bb + (fb - bb) * sc2);
        }
        a = hardCut
          ? t >= tLow
            ? 255
            : 0
          : tLow > 0
            ? Math.round(Math.min(1, t / tLow) * 255)
            : 255;
      }

      // Text mask (brush mode): override to colorHigh inside the glyph.
      if (textAlphaFrame[i] > 0.01) {
        r = fr;
        g = fg;
        b = fb;
        a = 255;
      }

      fd[j] = r;
      fd[j + 1] = g;
      fd[j + 2] = b;
      fd[j + 3] = a;
    }
    fctx.putImageData(frameData, 0, 0);

    // Fill canvas with bgColor, then composite transparent RD frame on top.
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = renderSc === 1;
    ctx.imageSmoothingQuality = 'high';
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
    '  // ── Simulation ────────────────────────────────────────────────────',
    '  //   try these presets (change feed + kill together):',
    '  //     spots:    feed 0.055  kill 0.062',
    '  //     cells:    feed 0.037  kill 0.060',
    '  //     spirals:  feed 0.025  kill 0.050',
    '  //     stripes:  feed 0.039  kill 0.058',
    `  feed: ${fmtVal(defaults.feed)},   // how fast the activator is fed in`,
    `  kill: ${fmtVal(defaults.kill)},   // how fast the activator is consumed`,
    `  speed: ${fmtVal(defaults.speed)},   // steps per animation frame — higher = faster growth`,
    `  scale: ${fmtVal(defaults.scale)},   // pattern thickness — higher = thicker lines, coarser simulation`,
    `  renderScale: ${fmtVal(defaults.renderScale)},   // render resolution — 1 = full quality, 2 = half res`,
    '',
    '  // ── Appearance ───────────────────────────────────────────────────',
    `  thresh: ${fmtVal(defaults.thresh)},   // true: snap to solid colors  |  false: smooth gradient`,
    `  threshVal: ${fmtVal(defaults.threshVal)},   // cutoff for solid mode (0–1; smaller = more ink)`,
    `  colorHigh: ${fmtVal(defaults.colorHigh)},   // color at dense areas`,
    `  colorLow: ${fmtVal(defaults.colorLow)},   // color at sparse areas`,
    `  lowPos: ${fmtVal(defaults.lowPos)},   // where colorLow sits (0 = at edge, 128 = halfway into gradient)`,
    `  hardCut: ${fmtVal(defaults.hardCut)},   // true: sharp edge at lowPos  |  false: fade to transparent`,
    `  bgColor: ${fmtVal(defaults.bgColor)},   // canvas background color`,
    '',
    '  // ── Brush ────────────────────────────────────────────────────────',
    `  brushMode: ${fmtVal(defaults.brushMode)},   // paint to grow the reaction — letters stay stable`,
    `  brushRadius: ${fmtVal(defaults.brushRadius)},   // brush size in pixels`,
  ];
}

export function normalizeParams(p) {
  return {
    feed: p.feed ?? defaults.feed,
    kill: p.kill ?? defaults.kill,
    speed: p.speed ?? defaults.speed,
    scale: p.scale ?? defaults.scale,
    renderScale: p.renderScale ?? defaults.renderScale,
    thresh: p.thresh ?? defaults.thresh,
    threshVal: p.threshVal ?? defaults.threshVal,
    lowPos: p.lowPos ?? defaults.lowPos,
    hardCut: p.hardCut ?? defaults.hardCut,
    brushMode: p.brushMode ?? defaults.brushMode,
    brushRadius: p.brushRadius ?? defaults.brushRadius,
    colorHigh: typeof p.colorHigh === 'string' ? p.colorHigh : defaults.colorHigh,
    colorLow: typeof p.colorLow === 'string' ? p.colorLow : defaults.colorLow,
    bgColor: typeof p.bgColor === 'string' ? p.bgColor : defaults.bgColor,
  };
}

export function getFilenameHint(p) {
  const feed = p.feed ?? defaults.feed;
  const kill = p.kill ?? defaults.kill;
  const high = String(p.colorHigh ?? defaults.colorHigh).replace('#', '');
  const low = String(p.colorLow ?? defaults.colorLow).replace('#', '');
  return `rd f${feed} k${kill} ${high}-${low}`;
}

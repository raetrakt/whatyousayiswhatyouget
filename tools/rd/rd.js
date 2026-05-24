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
  thresh: true, // snap to solid fill/bg colors instead of smooth gradient
  threshVal: 0.2, // V cutoff when thresh is true (0–1, try 0.1–0.3)
  fillColor: '#000000',
  bgColor: '#ffffff',
};

// Version counter cancels stale animation loops on re-render.
let _version = 0;

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
  const thresh = params.thresh ?? defaults.thresh;
  const threshVal = params.threshVal ?? defaults.threshVal;
  const fillColor = params.fillColor ?? defaults.fillColor;
  const bgColor = params.bgColor ?? defaults.bgColor;

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

  for (let i = 0; i < n; i++) {
    if (pxData[i * 4] < 128) {
      uA[i] = 0.5 + (Math.random() - 0.5) * 0.1;
      vA[i] = 0.25 + Math.random() * 0.05;
    }
  }

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

  // ── 6. Animation loop ──────────────────────────────────────────────────────
  function loop() {
    if (_version !== version) return; // stale render — stop

    for (let i = 0; i < stepsPerFrame; i++) stepOnce();

    // Map V → color.
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      if (thresh) {
        const on = vA[i] >= threshVal;
        fd[j] = on ? fr : br;
        fd[j + 1] = on ? fg : bg2;
        fd[j + 2] = on ? fb : bb;
      } else {
        const t = Math.min(1, vA[i] * 2.5);
        fd[j] = Math.round(br + (fr - br) * t);
        fd[j + 1] = Math.round(bg2 + (fg - bg2) * t);
        fd[j + 2] = Math.round(bb + (fb - bb) * t);
      }
      fd[j + 3] = 255;
    }
    fctx.putImageData(frameData, 0, 0);

    ctx.clearRect(0, 0, cssW, cssH);
    // imageSmoothingEnabled = false gives a pixelated look at scale > 1.
    ctx.imageSmoothingEnabled = sc === 1;
    ctx.drawImage(frame, 0, 0, cssW, cssH);

    requestAnimationFrame(loop);
  }

  loop();
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
    `  fillColor: ${fmtVal(defaults.fillColor)},  // high-V color`,
    `  bgColor: ${fmtVal(defaults.bgColor)},    // low-V / background color`,
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
    fillColor: typeof p.fillColor === 'string' ? p.fillColor : defaults.fillColor,
    bgColor: typeof p.bgColor === 'string' ? p.bgColor : defaults.bgColor,
  };
}

export function getFilenameHint(p) {
  const feed = p.feed ?? defaults.feed;
  const kill = p.kill ?? defaults.kill;
  const fill = String(p.fillColor ?? defaults.fillColor).replace('#', '');
  const bg = String(p.bgColor ?? defaults.bgColor).replace('#', '');
  return `rd f${feed} k${kill} ${fill} ${bg}`;
}

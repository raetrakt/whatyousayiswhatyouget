// Path resampling tool.
// Resamples opentype glyph outlines at uniform arc-length intervals,
// places a marker at every point, then optionally runs a repulsion-based
// relaxation so points travel from the outline to uniformly fill the interior.
//
// Two sampling modes:
//   font path  — opentype path resampled at arc-length `spacing`
//   mask mode  — pre-rendered maskCanvas (A4/16:9 SVG titles); edge pixels
//                are grid-bucketed for uniform initial density
//
// Relaxation: spatial-grid repulsion (O(n) per step) clamped to the text
// interior. Version counter cancels stale loops on re-render.

export const defaults = {
  spacing: 20, // arc-length gap between initial markers (px)
  marker: '✻', // unicode character placed at each point
  markerSize: 22, // font-size of the marker glyph (px)
  markerColor: '#6b3200',
  strokeColor: '#e2fe43', // stroke colour — null = no stroke
  strokeWidth: 10, // stroke width (px)
  bgColor: '#ffffff',
  flatness: 0.5, // bezier subdivision tolerance — font mode only (px)
  relax: false, // enable relaxation animation
  relaxSpeed: 8, // pixels moved per step per unit force
  period: 6, // seconds for one full spread-and-return cycle
  cursorRadius: 1650, // px — influence radius around cursor (0 = off)
  cursorScale: 5, // scale multiplier at cursor centre
  cursorRotation: 270, // degrees rotation at cursor centre
  cursorFalloff: 4, // cycles — 1 = smooth cosine drop, 2 = ring (drops then rises), higher = more rings
};

// ─── Cursor tracking ─────────────────────────────────────────────────────────

let _cursor = { x: -9999, y: -9999 };

function _setupCursorListener(canvas) {
  if (canvas.__resamplingCursorAttached) return;
  canvas.__resamplingCursorAttached = true;
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    _cursor.x = e.clientX - r.left;
    _cursor.y = e.clientY - r.top;
  });
  canvas.addEventListener('mouseleave', () => {
    _cursor.x = -9999;
    _cursor.y = -9999;
  });
}

/** Flatten an opentype.js Path into an array of {x,y} polyline vertices. */
function _flattenPath(otPath, flatness) {
  const subpaths = [];
  let current = [];
  let cx = 0,
    cy = 0;
  let sx = 0,
    sy = 0;

  function add(x, y) {
    if (
      !current.length ||
      current[current.length - 1].x !== x ||
      current[current.length - 1].y !== y
    )
      current.push({ x, y });
  }

  function finishSubpath() {
    if (current.length > 1) {
      // Auto-close: fonts may omit the final Z, leaving the closing edge implicit.
      const first = current[0],
        last = current[current.length - 1];
      if (first.x !== last.x || first.y !== last.y) {
        current.push({ x: first.x, y: first.y });
      }
      subpaths.push(current);
    }
    current = [];
  }

  // Sample a cubic Bézier at uniform t-intervals.
  // n scales with chord length so tight curves get enough samples.
  function sampleCubic(x0, y0, x1, y1, x2, y2, x3, y3) {
    const dx = x3 - x0,
      dy = y3 - y0;
    const chord = Math.sqrt(dx * dx + dy * dy);
    const n = Math.max(1, Math.ceil(chord / flatness));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      const mt2 = mt * mt,
        t2 = t * t;
      const mt3 = mt2 * mt,
        t3 = t2 * t;
      add(
        mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3,
        mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3,
      );
    }
  }

  // Sample a quadratic Bézier at uniform t-intervals.
  function sampleQuad(x0, y0, x1, y1, x2, y2) {
    const dx = x2 - x0,
      dy = y2 - y0;
    const chord = Math.sqrt(dx * dx + dy * dy);
    const n = Math.max(1, Math.ceil(chord / flatness));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      add(mt * mt * x0 + 2 * mt * t * x1 + t * t * x2, mt * mt * y0 + 2 * mt * t * y1 + t * t * y2);
    }
  }

  for (const cmd of otPath.commands) {
    switch (cmd.type) {
      case 'M':
        finishSubpath();
        add(cmd.x, cmd.y);
        cx = sx = cmd.x;
        cy = sy = cmd.y;
        break;
      case 'L':
        add(cmd.x, cmd.y);
        cx = cmd.x;
        cy = cmd.y;
        break;
      case 'C':
        sampleCubic(cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        cx = cmd.x;
        cy = cmd.y;
        break;
      case 'Q':
        sampleQuad(cx, cy, cmd.x1, cmd.y1, cmd.x, cmd.y);
        cx = cmd.x;
        cy = cmd.y;
        break;
      case 'Z':
        add(sx, sy);
        finishSubpath();
        cx = sx;
        cy = sy;
        break;
    }
  }
  finishSubpath();
  return subpaths;
}

/**
 * Walk a polyline emitting points at uniform arc-length `spacing`.
 * Computes total length first, then places floor(total/spacing) markers
 * centered within the path so no segment is ever skipped by a large rem.
 */
function _resamplePolyline(pts, spacing) {
  if (pts.length < 2 || spacing <= 0) return [];

  // Build per-segment lengths
  const segLens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x,
      dy = pts[i].y - pts[i - 1].y;
    const l = Math.sqrt(dx * dx + dy * dy);
    segLens.push(l);
    total += l;
  }

  const n = Math.floor(total / spacing);
  // If the path is shorter than one spacing interval, place a single marker
  // at its midpoint so short features (serifs, apex of A, etc.) aren't invisible.
  if (n === 0) {
    const mid = total / 2;
    let walked = 0;
    for (let i = 0; i < segLens.length; i++) {
      if (walked + segLens[i] >= mid) {
        const frac = segLens[i] > 0 ? (mid - walked) / segLens[i] : 0;
        return [
          {
            x: pts[i].x + (pts[i + 1].x - pts[i].x) * frac,
            y: pts[i].y + (pts[i + 1].y - pts[i].y) * frac,
          },
        ];
      }
      walked += segLens[i];
    }
    return [{ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }];
  }

  // Center the markers: equal gap at both ends of the path
  const startOffset = (total - n * spacing) / 2;
  const out = [];
  let segStart = 0; // cumulative length at start of current segment
  let si = 0; // current segment index

  for (let k = 0; k < n; k++) {
    const target = startOffset + k * spacing;
    // Advance to the segment containing `target`
    while (si < segLens.length - 1 && segStart + segLens[si] < target) {
      segStart += segLens[si];
      si++;
    }
    const frac = segLens[si] > 0 ? (target - segStart) / segLens[si] : 0;
    out.push({
      x: pts[si].x + (pts[si + 1].x - pts[si].x) * frac,
      y: pts[si].y + (pts[si + 1].y - pts[si].y) * frac,
    });
  }
  return out;
}

/** X-start of a centred line (mirrors quadtree's _lineStartX). */
function _lineStartX(line, fontSize, tracking, font, cssW) {
  const scale = fontSize / font.unitsPerEm;
  const chars = [...line];
  const gs = chars.map((ch) => font.charToGlyph(ch));
  let w = 0;
  for (let i = 0; i < gs.length; i++) {
    w += gs[i].advanceWidth * scale + tracking;
    if (i < gs.length - 1) w += font.getKerningValue(gs[i], gs[i + 1]) * scale;
  }
  return (cssW - (w - tracking)) / 2;
}

/** All resampled points for one line of text (font-path mode). */
function _sampleLine(font, line, x, y, fontSize, tracking, spacing, flatness) {
  const scale = fontSize / font.unitsPerEm;
  const chars = [...line];
  const gs = chars.map((ch) => font.charToGlyph(ch));
  const out = [];
  let cx = x;
  for (let i = 0; i < gs.length; i++) {
    if (chars[i].trim()) {
      const path = gs[i].getPath(cx, y, fontSize);
      const subpaths = _flattenPath(path, flatness);
      for (const sub of subpaths) for (const p of _resamplePolyline(sub, spacing)) out.push(p);
    }
    const kern = i < gs.length - 1 ? font.getKerningValue(gs[i], gs[i + 1]) * scale : 0;
    cx += gs[i].advanceWidth * scale + tracking + kern;
  }
  return out;
}

// ─── Mask / raster helpers ────────────────────────────────────────────────────

/**
 * Rasterize text to an offscreen canvas and return a Uint8Array where
 * 1 = inside text, 0 = outside.  Works for both font-path and mask-SVG modes.
 */
function _buildInsideMask(maskCanvas, font, lines, fontSize, startY, lineH, tracking, cssW, cssH) {
  const off = document.createElement('canvas');
  off.width = cssW;
  off.height = cssH;
  const octx = off.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, cssW, cssH);

  if (maskCanvas) {
    octx.drawImage(maskCanvas, 0, 0, cssW, cssH);
  } else {
    _drawGlyphs(octx, font, lines, fontSize, startY, lineH, tracking, cssW);
  }

  const data = octx.getImageData(0, 0, cssW, cssH).data;
  const mask = new Uint8Array(cssW * cssH);
  for (let i = 0; i < cssW * cssH; i++) mask[i] = data[i * 4] < 128 ? 1 : 0;
  return mask;
}

/** Draw filled black glyphs onto `rctx` using the opentype font. */
function _drawGlyphs(rctx, font, lines, fontSize, startY, lineH, tracking, cssW) {
  const scale = fontSize / font.unitsPerEm;
  for (let i = 0; i < lines.length; i++) {
    let cx = _lineStartX(lines[i], fontSize, tracking, font, cssW);
    const y = startY + i * lineH;
    const chars = [...lines[i]];
    const gs = chars.map((ch) => font.charToGlyph(ch));
    for (let j = 0; j < gs.length; j++) {
      const p = font.getPath(chars[j], cx, y, fontSize);
      p.fill = '#000';
      p.draw(rctx);
      const kern = j < gs.length - 1 ? font.getKerningValue(gs[j], gs[j + 1]) * scale : 0;
      cx += gs[j].advanceWidth * scale + tracking + kern;
    }
  }
}

/**
 * Collect edge pixels from `mask`, bucket into `cellSize`-px grid cells,
 * and return one centroid per occupied cell.
 */
function _sampleEdges(mask, cssW, cssH, cellSize) {
  function isIn(x, y) {
    if (x < 0 || y < 0 || x >= cssW || y >= cssH) return false;
    return mask[y * cssW + x] === 1;
  }
  const cols = Math.ceil(cssW / cellSize);
  const rows = Math.ceil(cssH / cellSize);
  const pts = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cellSize,
        y0 = row * cellSize;
      const x1 = Math.min(x0 + cellSize, cssW);
      const y1 = Math.min(y0 + cellSize, cssH);
      let sx = 0,
        sy = 0,
        n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (
            isIn(x, y) &&
            (!isIn(x - 1, y) || !isIn(x + 1, y) || !isIn(x, y - 1) || !isIn(x, y + 1))
          ) {
            sx += x;
            sy += y;
            n++;
          }
        }
      }
      if (n > 0) pts.push({ x: sx / n + 0.5, y: sy / n + 0.5 });
    }
  }
  return pts;
}

// ─── Render ───────────────────────────────────────────────────────────────────

let _version = 0;
let _points = []; // last computed positions – reserved for future drag / stroke

export function render(
  ctx,
  font,
  canvas,
  { lines, fontSize, startY, lineH, params, cssW, cssH, maskCanvas },
) {
  const version = ++_version;

  const spacing = Math.max(1, params.spacing ?? defaults.spacing);
  const marker = params.marker ?? defaults.marker;
  const markerSize = Math.max(2, params.markerSize ?? defaults.markerSize);
  const markerColor = params.markerColor ?? defaults.markerColor;
  const bgColor = params.bgColor ?? defaults.bgColor;
  const flatness = Math.max(0.05, params.flatness ?? defaults.flatness);
  const tracking = params.tracking ?? 0;
  const relax = params.relax ?? defaults.relax;
  const relaxSpeed = params.relaxSpeed ?? defaults.relaxSpeed;
  const period = Math.max(0.5, params.period ?? defaults.period);

  // ── 1. Build inside mask ──────────────────────────────────────────────────
  const mask = _buildInsideMask(
    maskCanvas,
    font,
    lines,
    fontSize,
    startY,
    lineH,
    tracking,
    cssW,
    cssH,
  );

  // ── 2. Initial points on the outline ─────────────────────────────────────
  let pts;
  if (maskCanvas) {
    pts = _sampleEdges(mask, cssW, cssH, spacing);
  } else {
    pts = [];
    for (let li = 0; li < lines.length; li++) {
      const y = startY + li * lineH;
      const x = _lineStartX(lines[li], fontSize, tracking, font, cssW);
      for (const p of _sampleLine(font, lines[li], x, y, fontSize, tracking, spacing, flatness))
        pts.push(p);
    }
  }

  const strokeColor = params.strokeColor ?? defaults.strokeColor;
  const strokeWidth = params.strokeWidth ?? defaults.strokeWidth;
  const cursorRadius = params.cursorRadius ?? defaults.cursorRadius;
  const cursorScale = params.cursorScale ?? defaults.cursorScale;
  const cursorRotation = params.cursorRotation ?? defaults.cursorRotation;
  const cursorFalloff = params.cursorFalloff ?? defaults.cursorFalloff;

  _setupCursorListener(canvas);

  // ── 3. Pre-rasterize marker to an offscreen bitmap ────────────────────────
  // Rasterizing text is expensive; doing it once and blitting with drawImage
  // is far cheaper than fillText/strokeText on every marker every frame.
  // Rasterize at the maximum possible display size (markerSize * cursorScale)
  // so markers are sharp even at peak cursor influence.
  const maxMarkerSize = markerSize * Math.max(1, cursorScale);
  const OVER = 2;
  // strokeWidth is authored in CSS px but scales with maxMarkerSize in the bitmap,
  // so the rendered half-stroke bleed is strokeWidth/2 * (maxMarkerSize/markerSize).
  const scaledStrokeHalf = strokeColor ? (strokeWidth / 2) * (maxMarkerSize / markerSize) : 0;
  const pad = scaledStrokeHalf + 2;
  const offSize = (maxMarkerSize + pad * 2) * OVER;
  const markerBitmap = document.createElement('canvas');
  markerBitmap.width = markerBitmap.height = offSize;
  const mctx = markerBitmap.getContext('2d');
  mctx.font = `${maxMarkerSize * OVER}px serif`;
  mctx.textAlign = 'center';
  mctx.textBaseline = 'middle';
  if (strokeColor) {
    mctx.strokeStyle = strokeColor;
    // strokeWidth is authored in CSS px. The bitmap is rasterized at maxMarkerSize
    // (which scales with cursorScale), so lineWidth must scale the same way to keep
    // the rendered stroke width constant regardless of cursorScale.
    mctx.lineWidth = strokeWidth * OVER * (maxMarkerSize / markerSize);
    mctx.strokeText(marker, offSize / 2, offSize / 2);
  }
  mctx.fillStyle = markerColor;
  mctx.fillText(marker, offSize / 2, offSize / 2);

  // Displayed size of the bitmap at 1:1 scale (CSS px)
  const normSize = offSize / OVER;
  const halfNorm = normSize / 2;
  // Scale factor to draw unaffected markers at their original size
  const baseScale = markerSize / maxMarkerSize;

  // ── 4. Draw helper ────────────────────────────────────────────────────────
  function draw() {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cssW, cssH);

    const maxRotRad = (cursorRotation * Math.PI) / 180;
    const cursorR2 = cursorRadius * cursorRadius;
    const base = ctx.getTransform();

    for (const { x, y } of pts) {
      let influence = 0;
      if (cursorRadius > 0) {
        const dx = x - _cursor.x,
          dy = y - _cursor.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < cursorR2) {
          const norm = Math.sqrt(d2) / cursorRadius;
          influence = 0.5 + 0.5 * Math.cos(norm * Math.PI * cursorFalloff);
        }
      }

      if (influence > 0) {
        // scale is relative to maxMarkerSize (the bitmap's full size)
        const scale = baseScale + (1 - baseScale) * influence;
        const rot = maxRotRad * influence;
        const cr = Math.cos(rot) * scale;
        const sr = Math.sin(rot) * scale;
        ctx.transform(cr, sr, -sr, cr, x, y);
        ctx.drawImage(markerBitmap, -halfNorm, -halfNorm, normSize, normSize);
        ctx.setTransform(base);
      } else {
        const s = baseScale;
        ctx.drawImage(markerBitmap, x - halfNorm * s, y - halfNorm * s, normSize * s, normSize * s);
      }
    }

    _points = pts;
  }

  if (!relax) {
    draw();
    // Redraw on mouse move so the cursor effect stays live.
    // Throttled to one draw per animation frame to avoid flooding the renderer.
    let _rafPending = false;
    const onMove = () => {
      if (_version !== version) return cleanup();
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(() => {
        _rafPending = false;
        if (_version === version) draw();
      });
    };
    const cleanup = () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onMove);
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onMove);
    return;
  }

  // ── 4. Looping spread-and-return simulation ──────────────────────────────
  // spreadFactor oscillates 0 → 1 → 0 over `period` seconds.
  //   spreadFactor = 1 → pure repulsion (points spread out)
  //   spreadFactor = 0 → pure attraction toward origin (points return)
  // Both forces share the same magnitude scale so motion is balanced.

  const repRadius = spacing * 1.5;
  const repRadius2 = repRadius * repRadius;

  // Fixed origin positions — the outline points never change.
  const originPts = pts.map((p) => ({ x: p.x, y: p.y }));

  function step(spreadFactor) {
    const returnFactor = 1 - spreadFactor;
    const cellSize = repRadius;
    const gridW = Math.ceil(cssW / cellSize) + 1;
    const gridH = Math.ceil(cssH / cellSize) + 1;
    const grid = Array.from({ length: gridW * gridH }, () => []);

    for (let i = 0; i < pts.length; i++) {
      const gx = (pts[i].x / cellSize) | 0;
      const gy = (pts[i].y / cellSize) | 0;
      grid[gy * gridW + gx].push(i);
    }

    const next = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let fx = 0,
        fy = 0;

      // Repulsion from neighbours (active while spreading)
      if (spreadFactor > 0) {
        const gx = (p.x / cellSize) | 0;
        const gy = (p.y / cellSize) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx,
              ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            for (const j of grid[ny * gridW + nx]) {
              if (j === i) continue;
              const ddx = p.x - pts[j].x;
              const ddy = p.y - pts[j].y;
              const d2 = ddx * ddx + ddy * ddy;
              if (d2 < repRadius2 && d2 > 0) {
                const d = Math.sqrt(d2);
                const s = (repRadius - d) / repRadius;
                fx += (ddx / d) * s * spreadFactor;
                fy += (ddy / d) * s * spreadFactor;
              }
            }
          }
        }
      }

      // Attraction toward origin (active while returning)
      // Normalised identically to repulsion so forces are balanced.
      if (returnFactor > 0) {
        const odx = originPts[i].x - p.x;
        const ody = originPts[i].y - p.y;
        const od = Math.sqrt(odx * odx + ody * ody);
        if (od > 0) {
          const s = Math.min(od / repRadius, 1);
          fx += (odx / od) * s * returnFactor;
          fy += (ody / od) * s * returnFactor;
        }
      }

      next[i] = {
        x: Math.max(0, Math.min(cssW - 1, p.x + fx * relaxSpeed)),
        y: Math.max(0, Math.min(cssH - 1, p.y + fy * relaxSpeed)),
      };
    }
    pts = next;
  }

  const startTime = performance.now();
  function loop(now) {
    if (_version !== version) return;
    const t = (now - startTime) / 1000 / period;
    const spreadFactor = (1 - Math.cos(2 * Math.PI * t)) / 2; // 0→1→0
    step(spreadFactor);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// ─── Tool interface ───────────────────────────────────────────────────────────

export function getParamLines(fmtVal) {
  return [
    '',
    '  // Path resampling',
    `  spacing: ${fmtVal(defaults.spacing)}, // arc-length gap between markers (px)`,
    `  marker: ${fmtVal(defaults.marker)}, // unicode glyph placed at each point`,
    `  markerSize: ${fmtVal(defaults.markerSize)}, // font-size of marker (px)`,
    `  markerColor: ${fmtVal(defaults.markerColor)},`,
    `  strokeColor: ${fmtVal(defaults.strokeColor)}, // stroke colour (null = no stroke)`,
    `  strokeWidth: ${fmtVal(defaults.strokeWidth)}, // stroke width (px)`,
    `  bgColor: ${fmtVal(defaults.bgColor)},`,
    '  // Particle relaxation',
    `  relax: ${fmtVal(defaults.relax)}, // animate spread-and-return loop`,
    `  relaxSpeed: ${fmtVal(defaults.relaxSpeed)}, // px moved per step per unit force`,
    `  period: ${fmtVal(defaults.period)}, // seconds for one full spread-and-return cycle`,
    '  // Cursor interaction',
    `  cursorRadius: ${fmtVal(defaults.cursorRadius)}, // px influence radius (0 = off)`,
    `  cursorScale: ${fmtVal(defaults.cursorScale)}, // scale at cursor centre`,
    `  cursorRotation: ${fmtVal(defaults.cursorRotation)}, // degrees rotation at cursor centre`,
    `  cursorFalloff: ${fmtVal(defaults.cursorFalloff)}, // cycles — 1 smooth drop, 2 = ring, higher = more rings`,
  ];
}

export function normalizeParams(p) {
  return {
    spacing: p.spacing ?? defaults.spacing,
    marker: p.marker ?? defaults.marker,
    markerSize: p.markerSize ?? defaults.markerSize,
    markerColor: typeof p.markerColor === 'string' ? p.markerColor : defaults.markerColor,
    strokeColor: typeof p.strokeColor === 'string' ? p.strokeColor : defaults.strokeColor,
    strokeWidth: p.strokeWidth ?? defaults.strokeWidth,
    bgColor: typeof p.bgColor === 'string' ? p.bgColor : defaults.bgColor,
    flatness: p.flatness ?? defaults.flatness,
    relax: p.relax ?? defaults.relax,
    relaxSpeed: p.relaxSpeed ?? defaults.relaxSpeed,
    period: p.period ?? defaults.period,
    cursorRadius: p.cursorRadius ?? defaults.cursorRadius,
    cursorScale: p.cursorScale ?? defaults.cursorScale,
    cursorRotation: p.cursorRotation ?? defaults.cursorRotation,
    cursorFalloff: p.cursorFalloff ?? defaults.cursorFalloff,
  };
}

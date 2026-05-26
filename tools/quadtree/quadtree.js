// Quadtree text visualization.
// Recursively subdivides cells that straddle the text boundary.
// Uniform cells (fully inside or fully outside) become leaf nodes.
// Uses a summed-area table for O(1) cell coverage queries.

export const defaults = {
  maxDepth: 7, // max subdivision levels (depth 7 → ~cssW/128 min cell)
  fillColor: '#000000',
  lineColor: '#000000',
  lineWidth: 0.5,
  bgColor: '#ffffff',
  brushMode: false, // paint higher detail where you drag
  brushRadius: 30, // brush size in CSS px
};

// ─── Brush state (persists across renders; reset on canvas resize) ───────────
let _version = 0;
let _brushGrid = null; // Uint8Array — accumulated depth per pixel
let _strokeGrid = null; // Uint8Array — mask for current stroke (prevents double-increment per drag)
let _brushW = 0;
let _brushH = 0;
let _brushModeActive = false;
let _brushRadiusPx = 30;
let _painting = false;
let _brushDirty = false;

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
  const maxDepth = params.maxDepth ?? defaults.maxDepth;
  const brushMode = params.brushMode ?? defaults.brushMode;
  const fillColor = typeof params.fillColor === 'string' ? params.fillColor : defaults.fillColor;
  const lineColor =
    params.lineColor === null
      ? null
      : typeof params.lineColor === 'string'
        ? params.lineColor
        : defaults.lineColor;
  const lineWidth = params.lineWidth ?? defaults.lineWidth;
  const bgColor = typeof params.bgColor === 'string' ? params.bgColor : defaults.bgColor;

  // Keep module-level brush params in sync — event handlers read these.
  const version = ++_version;
  _brushModeActive = brushMode;
  _brushRadiusPx = params.brushRadius ?? defaults.brushRadius;

  // Reset brush strokes on every render (code change or resize).
  _brushGrid = new Uint8Array(cssW * cssH);
  _strokeGrid = new Uint8Array(cssW * cssH);
  _brushW = cssW;
  _brushH = cssH;

  if (brushMode) _setupBrushListeners(canvas);

  // Sync cursor style and indicator visibility on every render.
  canvas.style.cursor = brushMode ? 'none' : '';
  if (canvas.__qtIndicator) canvas.__qtIndicator.style.display = 'none';

  // ── 1. Rasterize text (black on white) to offscreen canvas ───────────────
  const off = document.createElement('canvas');
  off.width = cssW;
  off.height = cssH;
  const octx = off.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, cssW, cssH);

  if (maskCanvas) {
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(maskCanvas, 0, 0, cssW, cssH);
  } else {
    _drawGlyphs(octx, font, lines, fontSize, startY, lineH, params, cssW, '#000');
  }

  const imgData = octx.getImageData(0, 0, cssW, cssH).data;

  // ── 2. Summed-area table ─────────────────────────────────────────────────
  const W1 = cssW + 1;
  const sat = new Int32Array(W1 * (cssH + 1));
  for (let y = 0; y < cssH; y++) {
    for (let x = 0; x < cssW; x++) {
      const inside = imgData[(y * cssW + x) * 4] < 128 ? 1 : 0;
      sat[(y + 1) * W1 + (x + 1)] =
        inside + sat[y * W1 + (x + 1)] + sat[(y + 1) * W1 + x] - sat[y * W1 + x];
    }
  }

  // Returns count of inside pixels in the canvas-visible part of square [x, y, x+size, y+size)
  function cellSumClamped(x, y, size) {
    const x2 = Math.min(x + size, cssW);
    const y2 = Math.min(y + size, cssH);
    if (x2 <= x || y2 <= y) return { sum: 0, total: 0 };
    const sum = sat[y2 * W1 + x2] - sat[y * W1 + x2] - sat[y2 * W1 + x] + sat[y * W1 + x];
    return { sum, total: (x2 - x) * (y2 - y) };
  }

  // ── 3. Frame draw (called once, or each dirty tick in brush mode) ──────────
  const startSize = 1 << Math.ceil(Math.log2(Math.max(cssW, cssH)));
  const liveResult = { leaves: [] };

  function drawFrame() {
    // Build a SAT of the brush grid so we can query painted regions in O(1).
    let bsat = null;
    let BW1 = 0;
    if (brushMode && _brushGrid) {
      ({ sat: bsat, W1: BW1 } = _buildBrushSAT(_brushGrid, cssW, cssH));
    }

    function brushDepthInCell(x, y, size) {
      if (!bsat) return 0;
      const x2 = Math.min(x + size, cssW);
      const y2 = Math.min(y + size, cssH);
      if (x2 <= x || y2 <= y) return 0;
      const sum = bsat[y2 * BW1 + x2] - bsat[y * BW1 + x2] - bsat[y2 * BW1 + x] + bsat[y * BW1 + x];
      if (sum === 0) return 0;
      const total = (x2 - x) * (y2 - y);
      return Math.ceil(sum / total);
    }

    const leaves = [];
    function subdivide(x, y, size, depth) {
      if (x >= cssW || y >= cssH) return;
      const { sum, total } = cellSumClamped(x, y, size);
      if (total === 0) return;
      const localMax = maxDepth + brushDepthInCell(x, y, size);
      if (sum === 0 || sum === total || depth >= localMax) {
        leaves.push({
          x,
          y,
          w: Math.min(size, cssW - x),
          h: Math.min(size, cssH - y),
          inside: sum > 0,
        });
        return;
      }
      const half = size >> 1;
      subdivide(x, y, half, depth + 1);
      subdivide(x + half, y, half, depth + 1);
      subdivide(x, y + half, half, depth + 1);
      subdivide(x + half, y + half, half, depth + 1);
    }
    subdivide(0, 0, startSize, 0);

    ctx.save();
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cssW, cssH);
    for (const { x, y, w, h, inside } of leaves) {
      if (inside) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(x, y, w, h);
      }
      if (lineColor) {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x + lineWidth / 2, y + lineWidth / 2, w - lineWidth, h - lineWidth);
      }
    }
    ctx.restore();
    liveResult.leaves = leaves;
    return liveResult;
  }

  if (!brushMode) {
    return drawFrame();
  }

  // ── 4. Brush animation loop ───────────────────────────────────────────────
  let lastResult = drawFrame();
  _brushDirty = false;

  function loop() {
    if (_version !== version) return;
    if (_brushDirty) {
      _brushDirty = false;
      lastResult = drawFrame();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return lastResult;
}

// ─── Brush helpers ────────────────────────────────────────────────────────────

function _setupBrushListeners(canvas) {
  if (canvas.__qtBrushAttached) return;
  canvas.__qtBrushAttached = true;

  // Brush size indicator — fixed-position circle that follows the cursor.
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
  canvas.__qtIndicator = indicator;

  function moveIndicator(e) {
    if (!_brushModeActive) return;
    const d = _brushRadiusPx * 2;
    indicator.style.width = `${d}px`;
    indicator.style.height = `${d}px`;
    indicator.style.left = `${e.clientX}px`;
    indicator.style.top = `${e.clientY}px`;
    indicator.style.display = 'block';
  }

  canvas.addEventListener('mouseenter', moveIndicator);
  canvas.addEventListener('mousemove', (e) => {
    moveIndicator(e);
    if (!_brushModeActive || !_painting) return;
    _paint(e);
  });
  canvas.addEventListener('mouseleave', () => {
    _painting = false;
    indicator.style.display = 'none';
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!_brushModeActive) return;
    _painting = true;
    if (_strokeGrid) _strokeGrid.fill(0);
    _paint(e);
  });
  canvas.addEventListener('mouseup', () => {
    _painting = false;
  });
}

function _paint(e) {
  if (!_brushGrid) return;
  const cx = Math.round(e.offsetX);
  const cy = Math.round(e.offsetY);
  const r = _brushRadiusPx;
  const r2 = r * r;
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(_brushW - 1, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(_brushH - 1, cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) {
        const i = y * _brushW + x;
        if (_strokeGrid && _strokeGrid[i] === 0) {
          if (_brushGrid[i] < 200) _brushGrid[i]++;
          _strokeGrid[i] = 1;
        }
      }
    }
  }
  _brushDirty = true;
}

function _buildBrushSAT(grid, gW, gH) {
  const W1 = gW + 1;
  const sat = new Int32Array(W1 * (gH + 1));
  for (let y = 0; y < gH; y++) {
    for (let x = 0; x < gW; x++) {
      sat[(y + 1) * W1 + (x + 1)] =
        grid[y * gW + x] + sat[y * W1 + (x + 1)] + sat[(y + 1) * W1 + x] - sat[y * W1 + x];
    }
  }
  return { sat, W1 };
}

// ─── Glyph rendering helpers ─────────────────────────────────────────────────

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

// ─── Tool interface ───────────────────────────────────────────────────────────────────

export function getParamLines(fmtVal) {
  return [
    '',
    '  // quadtree',
    `  maxDepth: ${fmtVal(defaults.maxDepth)}, // max subdivision levels`,
    `  fillColor: ${fmtVal(defaults.fillColor)}, // inside cell color`,
    `  lineColor: ${fmtVal(defaults.lineColor)}, // cell border color (null = none)`,
    `  lineWidth: ${fmtVal(defaults.lineWidth)}, // border width px`,
    `  bgColor: ${fmtVal(defaults.bgColor)}, // background`,
    `  brushMode: ${fmtVal(defaults.brushMode)}, // enable detail brush`,
    `  brushRadius: ${fmtVal(defaults.brushRadius)}, // brush size (CSS px)`,
  ];
}

export function normalizeParams(p) {
  return {
    maxDepth: p.maxDepth ?? defaults.maxDepth,
    fillColor: typeof p.fillColor === 'string' ? p.fillColor : defaults.fillColor,
    lineColor:
      p.lineColor === null
        ? null
        : typeof p.lineColor === 'string'
          ? p.lineColor
          : defaults.lineColor,
    lineWidth: p.lineWidth ?? defaults.lineWidth,
    bgColor: typeof p.bgColor === 'string' ? p.bgColor : defaults.bgColor,
    brushMode: p.brushMode ?? defaults.brushMode,
    brushRadius: p.brushRadius ?? defaults.brushRadius,
  };
}

export function getFilenameHint(p) {
  const depth = p.maxDepth ?? defaults.maxDepth;
  const fill = String(p.fillColor ?? defaults.fillColor).replace('#', '');
  const bg = String(p.bgColor ?? defaults.bgColor).replace('#', '');
  return `qt d${depth} ${fill} ${bg}`;
}

/** Called after render(). Returns the getSVG callback for the save button. */
export function afterRender(result, params, cssW, cssH) {
  const snapshot = { result, params: { ...params }, cssW, cssH };
  return () => _generateSVG(snapshot);
}

function _generateSVG({ result, params, cssW, cssH }) {
  const { leaves } = result;
  const sx = params.width / cssW;
  const sy = params.height / cssH;
  const fill = params.fillColor;
  const bg = params.bgColor;
  const lc = params.lineColor;
  const lw = (params.lineWidth * sx).toFixed(4);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${params.width} ${params.height}" width="${params.width}mm" height="${params.height}mm">`,
    `  <rect width="${params.width}" height="${params.height}" fill="${bg}"/>`,
  ];

  for (const { x, y, w, h, inside } of leaves) {
    const rx = (x * sx).toFixed(3);
    const ry = (y * sy).toFixed(3);
    const rw = (w * sx).toFixed(3);
    const rh = (h * sy).toFixed(3);
    const strokeAttr = lc ? ` stroke="${lc}" stroke-width="${lw}"` : '';
    if (inside) {
      lines.push(
        `  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fill}"${strokeAttr}/>`,
      );
    } else if (lc) {
      lines.push(
        `  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none"${strokeAttr}/>`,
      );
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}

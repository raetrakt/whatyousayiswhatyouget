// Quadtree text visualization.
// Recursively subdivides cells that straddle the text boundary.
// Uniform cells (fully inside or fully outside) become leaf nodes.
// Uses a summed-area table for O(1) cell coverage queries.

export const defaults = {
  maxDepth: 7,        // max subdivision levels (depth 7 → ~cssW/128 min cell)
  fillColor: '#000000',
  lineColor: '#000000',
  lineWidth: 0.5,
  bgColor: '#ffffff',
};

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
  const fillColor = typeof params.fillColor === 'string' ? params.fillColor : defaults.fillColor;
  const lineColor =
    params.lineColor === null ? null
    : typeof params.lineColor === 'string' ? params.lineColor
    : defaults.lineColor;
  const lineWidth = params.lineWidth ?? defaults.lineWidth;
  const bgColor = typeof params.bgColor === 'string' ? params.bgColor : defaults.bgColor;

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

  // ── 2. Summed-area table (integral image) ────────────────────────────────
  // sat[(y+1)*(cssW+1) + (x+1)] = count of inside pixels in rect [0,0)→[x,y)
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

  // ── 3. Recursive quadtree subdivision ────────────────────────────────────
  // Start from the smallest power-of-2 square covering the canvas so all
  // interior cells are perfectly square. Edge cells are clipped to canvas bounds.
  const startSize = 1 << Math.ceil(Math.log2(Math.max(cssW, cssH)));
  const leaves = []; // { x, y, w, h, inside }

  function subdivide(x, y, size, depth) {
    if (x >= cssW || y >= cssH) return; // entirely outside canvas
    const { sum, total } = cellSumClamped(x, y, size);
    if (total === 0) return;

    // Leaf: uniform cell or maximum depth reached
    if (sum === 0 || sum === total || depth >= maxDepth) {
      leaves.push({ x, y, w: Math.min(size, cssW - x), h: Math.min(size, cssH - y), inside: sum > 0 });
      return;
    }

    const half = size >> 1;
    subdivide(x,        y,        half, depth + 1);
    subdivide(x + half, y,        half, depth + 1);
    subdivide(x,        y + half, half, depth + 1);
    subdivide(x + half, y + half, half, depth + 1);
  }

  subdivide(0, 0, startSize, 0);

  // ── 4. Draw leaf cells ────────────────────────────────────────────────────
  ctx.save();
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
  return { leaves };
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
      const kern =
        j < gs.length - 1 ? font.getKerningValue(gs[j], gs[j + 1]) * scale : 0;
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

// Falling-sand text simulation.
// Text pixels become sand particles that fall and pile up under gravity.
//
// Technique from:
// https://pvigier.github.io/2020/12/12/procedural-death-animation-with-falling-sand-automata.html

export const defaults = {
  speed: 8, // simulation steps per frame (higher = faster crumbling)
  threshold: 240, // pixel brightness cutoff (0–255): higher includes more anti-aliased edge pixels
  fillColor: '#000000',
  bgColor: '#ffffff',
  collapseDelay: 8, // animation frames between each character's release (0 = all at once)
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
  // Bump version so any running loop knows to stop.
  const version = ++_version;

  const fillColor = params.fillColor ?? defaults.fillColor;
  const bgColor = params.bgColor ?? defaults.bgColor;
  const stepsPerFrame = Math.max(1, Math.round(params.speed ?? defaults.speed));
  const threshold = Math.max(1, Math.min(255, Math.round(params.threshold ?? defaults.threshold)));
  const collapseDelay = Math.max(0, Math.round(params.collapseDelay ?? defaults.collapseDelay));

  // ── 1. Rasterize all text together → source for per-pixel colour blending ──
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

  // ── 2. Build colour grid ───────────────────────────────────────────────────
  const [fr, fg, fb] = _hexToRgb(fillColor);
  const [br, bg2, bb] = _hexToRgb(bgColor);
  const bgU32 = br | (bg2 << 8) | (bb << 16) | (255 << 24);

  const pxData = octx.getImageData(0, 0, cssW, cssH).data;
  const grid = new Uint32Array(cssW * cssH);
  for (let i = 0; i < cssW * cssH; i++) {
    const t = pxData[i * 4];
    if (t >= threshold) continue;
    const s = t / threshold;
    const r = Math.round(fr + (br - fr) * s);
    const g = Math.round(fg + (bg2 - fg) * s);
    const b = Math.round(fb + (bb - fb) * s);
    grid[i] = r | (g << 8) | (b << 16) | (255 << 24);
  }

  // ── 3. Per-character pixel ownership → staggered release ──────────────────
  // Each pixel is claimed by the first (leftmost) glyph that covers it,
  // so kerning overlaps (e.g. "Yo") correctly belong to the earlier character.
  const charIdx = new Uint16Array(cssW * cssH); // 1-based; 0 = unassigned
  const frozen  = new Uint8Array(cssW * cssH);  // 1 = locked, 0 = active
  let charPixelLists = []; // charPixelLists[ci] → grid indices owned by char ci

  if (!maskCanvas && lines.length > 0 && collapseDelay > 0) {
    const charList = _enumerateChars(font, lines, fontSize, startY, lineH, params, cssW);
    const scale = fontSize / font.unitsPerEm;
    const tmp  = document.createElement('canvas');
    const tctx = tmp.getContext('2d');

    for (let ci = 0; ci < charList.length; ci++) {
      const { ch, cx, cy } = charList[ci];
      const pixels = [];

      if (ch.trim() !== '') {
        const glyph = font.charToGlyph(ch);
        if (glyph?.path?.commands?.length > 0) {
          const bb = glyph.getBoundingBox();
          const bx1 = Math.max(0, Math.floor(cx + bb.x1 * scale) - 2);
          const by1 = Math.max(0, Math.floor(cy - bb.y2 * scale) - 2);
          const bx2 = Math.min(cssW, Math.ceil(cx  + bb.x2 * scale) + 2);
          const by2 = Math.min(cssH, Math.ceil(cy  - bb.y1 * scale) + 2);
          const bw = bx2 - bx1, bh = by2 - by1;

          if (bw > 0 && bh > 0) {
            tmp.width  = bw;
            tmp.height = bh;
            tctx.fillStyle = '#fff';
            tctx.fillRect(0, 0, bw, bh);
            const path = font.getPath(ch, cx - bx1, cy - by1, fontSize);
            path.fill = '#000';
            path.draw(tctx);
            const pd = tctx.getImageData(0, 0, bw, bh).data;

            for (let ty = 0; ty < bh; ty++) {
              for (let tx = 0; tx < bw; tx++) {
                const fi = (by1 + ty) * cssW + (bx1 + tx);
                if (charIdx[fi] === 0 && pd[(ty * bw + tx) * 4] < threshold && grid[fi] !== 0) {
                  charIdx[fi] = ci + 1;
                  frozen[fi]  = 1;
                  pixels.push(fi);
                }
              }
            }
          }
        }
      }

      charPixelLists.push(pixels);
    }

    // Catch any unassigned text pixels (sub-pixel edges) → append to last char's list
    const lastList = charPixelLists[charPixelLists.length - 1];
    if (lastList) {
      for (let i = 0; i < cssW * cssH; i++) {
        if (grid[i] !== 0 && charIdx[i] === 0) {
          charIdx[i] = charPixelLists.length;
          frozen[i]  = 1;
          lastList.push(i);
        }
      }
    }
  }

  // ── 4. Frame canvas for blitting ──────────────────────────────────────────
  const frame = document.createElement('canvas');
  frame.width = cssW;
  frame.height = cssH;
  const fctx = frame.getContext('2d');
  const frameData = fctx.createImageData(cssW, cssH);
  const frameU32 = new Uint32Array(frameData.data.buffer);

  // ── 5. Single simulation step ─────────────────────────────────────────────
  function stepOnce() {
    for (let y = cssH - 2; y >= 0; y--) {
      const rowBase     = y * cssW;
      const nextRowBase = (y + 1) * cssW;
      for (let x = 0; x < cssW; x++) {
        const idx = rowBase + x;
        if (grid[idx] === 0 || frozen[idx]) continue;

        const downIdx = nextRowBase + x;
        if (grid[downIdx] === 0) {
          grid[downIdx] = grid[idx];
          grid[idx] = 0;
          continue;
        }

        const canLeft  = x > 0;
        const canRight = x < cssW - 1;
        if (canLeft && canRight) {
          const goLeft = Math.random() < 0.5;
          const first  = goLeft ? downIdx - 1 : downIdx + 1;
          const second = goLeft ? downIdx + 1 : downIdx - 1;
          if (grid[first] === 0) {
            grid[first] = grid[idx];
            grid[idx] = 0;
          } else if (grid[second] === 0) {
            grid[second] = grid[idx];
            grid[idx] = 0;
          }
        } else if (canLeft && grid[downIdx - 1] === 0) {
          grid[downIdx - 1] = grid[idx];
          grid[idx] = 0;
        } else if (canRight && grid[downIdx + 1] === 0) {
          grid[downIdx + 1] = grid[idx];
          grid[idx] = 0;
        }
      }
    }
  }

  // ── 6. Animation loop with left-to-right staged release ───────────────────
  let frameCount  = 0;
  let nextRelease = 0;

  function loop() {
    if (_version !== version) return;

    // Release characters whose frame has come; O(pixels-per-char) per release.
    while (nextRelease < charPixelLists.length && frameCount >= nextRelease * collapseDelay) {
      for (const i of charPixelLists[nextRelease]) {
        if (grid[i] !== 0) frozen[i] = 0;
      }
      nextRelease++;
    }
    frameCount++;

    for (let s = 0; s < stepsPerFrame; s++) stepOnce();

    frameU32.fill(bgU32);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== 0) frameU32[i] = grid[i];
    }
    fctx.putImageData(frameData, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(frame, 0, 0);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
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

function _enumerateChars(font, lines, fontSize, startY, lineH, params, cssW) {
  const scale = fontSize / font.unitsPerEm;
  const result = [];
  for (let li = 0; li < lines.length; li++) {
    const y = startY + li * lineH;
    let cx = _lineStartX(lines[li], fontSize, params, font, cssW);
    const chars = [...lines[li]];
    const gs = chars.map((ch) => font.charToGlyph(ch));
    for (let j = 0; j < chars.length; j++) {
      result.push({ ch: chars[j], cx, cy: y });
      const kern = j < chars.length - 1 ? font.getKerningValue(gs[j], gs[j + 1]) * scale : 0;
      cx += gs[j].advanceWidth * scale + (params.tracking || 0) + kern;
    }
  }
  return result;
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
    '  // sand',
    `  speed: ${fmtVal(defaults.speed)}, // simulation steps per frame`,
    `  threshold: ${fmtVal(defaults.threshold)}, // pixel brightness cutoff (0–255); higher = more soft-edge pixels`,
    `  collapseDelay: ${fmtVal(defaults.collapseDelay)}, // animation frames between each character's release (0 = all at once)`,
    `  fillColor: ${fmtVal(defaults.fillColor)}, // particle color`,
    `  bgColor: ${fmtVal(defaults.bgColor)}, // background`,
  ];
}

export function normalizeParams(p) {
  return {
    speed: p.speed ?? defaults.speed,
    threshold: p.threshold ?? defaults.threshold,
    collapseDelay: p.collapseDelay ?? defaults.collapseDelay,
    fillColor: typeof p.fillColor === 'string' ? p.fillColor : defaults.fillColor,
    bgColor: typeof p.bgColor === 'string' ? p.bgColor : defaults.bgColor,
  };
}

export function getFilenameHint(p) {
  const fill = String(p.fillColor ?? defaults.fillColor).replace('#', '');
  const bg = String(p.bgColor ?? defaults.bgColor).replace('#', '');
  return `sand ${fill} ${bg}`;
}

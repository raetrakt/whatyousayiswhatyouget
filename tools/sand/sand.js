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

  // ── 1. Rasterize text black-on-white to offscreen canvas (CSS dimensions) ──
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

  // ── 2. Build particle grid ─────────────────────────────────────────────────
  const [fr, fg, fb] = _hexToRgb(fillColor);
  const [br, bg2, bb] = _hexToRgb(bgColor);
  // Packed RGBA in little-endian byte order (matches ImageData Uint8 layout).
  const bgU32 = br | (bg2 << 8) | (bb << 16) | (255 << 24);
  const fillU32 = fr | (fg << 8) | (fb << 16) | (255 << 24);

  const pxData = octx.getImageData(0, 0, cssW, cssH).data;
  const grid = new Uint32Array(cssW * cssH);
  for (let i = 0; i < cssW * cssH; i++) {
    const t = pxData[i * 4]; // R channel: 0 = black (text), 255 = white (bg)
    if (t >= threshold) continue; // background — leave as 0 (empty)
    // Blend fill→bg by darkness so edge pixels carry a proportionally lighter shade.
    const s = t / threshold; // 0 at full black, approaching 1 at the cutoff edge
    const r = Math.round(fr + (br - fr) * s);
    const g = Math.round(fg + (bg2 - fg) * s);
    const b = Math.round(fb + (bb - fb) * s);
    grid[i] = r | (g << 8) | (b << 16) | (255 << 24);
  }

  // ── 3. Frame canvas for blitting — created once, reused each tick ──────────
  const frame = document.createElement('canvas');
  frame.width = cssW;
  frame.height = cssH;
  const fctx = frame.getContext('2d');
  const frameData = fctx.createImageData(cssW, cssH);
  const frameU32 = new Uint32Array(frameData.data.buffer);

  // ── 4. Single simulation step ──────────────────────────────────────────────
  function stepOnce() {
    // Scan bottom-to-top so falling particles don't cascade multiple rows per step.
    for (let y = cssH - 2; y >= 0; y--) {
      const rowBase = y * cssW;
      const nextRowBase = (y + 1) * cssW;
      for (let x = 0; x < cssW; x++) {
        const idx = rowBase + x;
        const val = grid[idx];
        if (val === 0) continue;

        // Try straight down first.
        const downIdx = nextRowBase + x;
        if (grid[downIdx] === 0) {
          grid[downIdx] = val;
          grid[idx] = 0;
          continue;
        }

        // Try diagonal left/right with a random preference to avoid left/right bias.
        const canLeft = x > 0;
        const canRight = x < cssW - 1;
        if (canLeft && canRight) {
          const goLeft = Math.random() < 0.5;
          const first = goLeft ? downIdx - 1 : downIdx + 1;
          const second = goLeft ? downIdx + 1 : downIdx - 1;
          if (grid[first] === 0) {
            grid[first] = val;
            grid[idx] = 0;
          } else if (grid[second] === 0) {
            grid[second] = val;
            grid[idx] = 0;
          }
        } else if (canLeft && grid[downIdx - 1] === 0) {
          grid[downIdx - 1] = val;
          grid[idx] = 0;
        } else if (canRight && grid[downIdx + 1] === 0) {
          grid[downIdx + 1] = val;
          grid[idx] = 0;
        }
      }
    }
  }

  // ── 5. Animation loop ──────────────────────────────────────────────────────
  function loop() {
    if (_version !== version) return; // stale render — stop

    for (let i = 0; i < stepsPerFrame; i++) stepOnce();

    // Compose frame: fill background then overlay particles.
    frameU32.fill(bgU32);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== 0) frameU32[i] = grid[i];
    }
    fctx.putImageData(frameData, 0, 0);

    // ctx has DPR transform applied by main.js — drawImage fills the full canvas.
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
    `  fillColor: ${fmtVal(defaults.fillColor)}, // particle color`,
    `  bgColor: ${fmtVal(defaults.bgColor)}, // background`,
  ];
}

export function normalizeParams(p) {
  return {
    speed: p.speed ?? defaults.speed,
    threshold: p.threshold ?? defaults.threshold,
    fillColor: typeof p.fillColor === 'string' ? p.fillColor : defaults.fillColor,
    bgColor: typeof p.bgColor === 'string' ? p.bgColor : defaults.bgColor,
  };
}

export function getFilenameHint(p) {
  const fill = String(p.fillColor ?? defaults.fillColor).replace('#', '');
  const bg = String(p.bgColor ?? defaults.bgColor).replace('#', '');
  return `sand ${fill} ${bg}`;
}

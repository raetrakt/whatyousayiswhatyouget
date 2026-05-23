// SDF bevel visualization.
// Signed distance field via the O(n) Felzenszwalb parabola algorithm.
// Gradient computed by finite differences → diffuse bevel lighting.

// Inspired by https://shaderfun.com/2018/07/23/signed-distance-fields-part-8-gradients-bevels-and-noise/
// MIT license

const SDF_SCALE = 2; // full-resolution — O(n) EDT makes this cheap

/** Default parameter values for the SDF bevel tool. */
export const defaults = {
  borderWidth: 0.45, // fraction of fontSize
  bevelCurvature: 1.0, // 0 = flat, higher = rounder bevel
  bevelPeak: 0, // where brightness peaks within the bevel (0 = inner edge, 0.5 = ridge, 1 = outer edge)
  lightAngle: 315, // degrees clockwise from top (315 = upper-left)
  specular: 0, // specular highlight intensity (0 = off)
  specularSharpness: 30, // Phong exponent — higher = tighter highlight spot
  fillColor: '#ffffff', // text fill
  gradientColor: '#5e69ff', // bevel fades to this color
  shadowColor: '#0800ff', // shadow side of bevel (replaces desaturation-to-black)
  bgColor: '#fff', // background
};

/**
 * render(ctx, font, canvas, layout)
 *
 * ctx     — the main canvas 2D context (DPR transform already applied)
 * font    — opentype.js Font object
 * canvas  — the main HTMLCanvasElement
 * layout  — { lines, fontSize, startY, lineH, params, cssW, cssH }
 */
export function render(
  ctx,
  font,
  canvas,
  { lines, fontSize, startY, lineH, params, cssW, cssH, maskCanvas },
) {
  // Resolve params with fallbacks
  // When maskCanvas is supplied (SVG case), fontSize is 0 — fall back to cssH/6
  const effectiveFontSize = fontSize > 0 ? fontSize : cssH / 6;
  const borderWidth = effectiveFontSize * SDF_SCALE * (params.borderWidth ?? defaults.borderWidth);
  const bevelCurvature = params.bevelCurvature ?? defaults.bevelCurvature;
  const bevelPeak = Math.max(0, Math.min(1, params.bevelPeak ?? defaults.bevelPeak));
  const specular = params.specular ?? defaults.specular;
  const specularSharpness = Math.max(1, params.specularSharpness ?? defaults.specularSharpness);
  const angleRad = ((params.lightAngle ?? defaults.lightAngle) * Math.PI) / 180;
  // lightAngle is degrees clockwise from top → convert to screen-space direction vector
  const LX = Math.sin(angleRad);
  const LY = -Math.cos(angleRad);
  const fill = _hexToRgb(params.fillColor ?? defaults.fillColor);
  const grad = _hexToRgb(params.gradientColor ?? defaults.gradientColor);
  const shadow = _hexToRgb(params.shadowColor ?? defaults.shadowColor);
  const bg = _hexToRgb(params.bgColor ?? defaults.bgColor);
  // ── 1. Render black text on white at SDF scale ────────────────────────────
  const sw = Math.max(2, Math.round(cssW * SDF_SCALE));
  const sh = Math.max(2, Math.round(cssH * SDF_SCALE));

  const off = document.createElement('canvas');
  off.width = sw;
  off.height = sh;
  const octx = off.getContext('2d');

  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, sw, sh);
  if (maskCanvas) {
    // Scale the pre-rendered CSS-size mask down to SDF resolution
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(maskCanvas, 0, 0, sw, sh);
  } else {
    octx.setTransform(SDF_SCALE, 0, 0, SDF_SCALE, 0, 0);
    _drawGlyphs(octx, font, lines, fontSize, startY, lineH, params, cssW, '#000');
    octx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ── 2. Classify pixels ────────────────────────────────────────────────────
  const pxData = octx.getImageData(0, 0, sw, sh).data;
  const isIn = new Uint8Array(sw * sh);
  const isOut = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    if (pxData[i * 4] < 128) isIn[i] = 1;
    else isOut[i] = 1;
  }

  // ── 3. Signed distance field via O(n) Felzenszwalb EDT ───────────────────
  const distToIn = _distSq2d(isIn, sw, sh); // sq dist to nearest inside pixel
  const distToOut = _distSq2d(isOut, sw, sh); // sq dist to nearest outside pixel
  const sdf = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    sdf[i] = isIn[i] ? -Math.sqrt(distToOut[i]) : Math.sqrt(distToIn[i]);
  }

  // ── 4. Gradient via finite differences (blog method) ─────────────────────
  const gx = new Float32Array(sw * sh);
  const gy = new Float32Array(sw * sh);
  const BIG = 1e9;

  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const i = py * sw + px;
      const d = sdf[i];
      const sign = d >= 0 ? 1 : -1;
      const big = BIG * sign;

      const x0 = px > 0 ? sdf[i - 1] : big;
      const x1 = px < sw - 1 ? sdf[i + 1] : big;
      const y0 = py > 0 ? sdf[i - sw] : big;
      const y1 = py < sh - 1 ? sdf[i + sw] : big;

      gx[i] = sign * x0 < sign * x1 ? -(x0 - d) : x1 - d;
      gy[i] = sign * y0 < sign * y1 ? -(y0 - d) : y1 - d;
    }
  }

  // ── 5. Bevel shading per pixel ────────────────────────────────────────────
  // borderWidth is in SDF pixels. CSS pixel equivalent = fontSize * BORDER_WIDTH_FACTOR.
  const imgData = octx.createImageData(sw, sh);

  for (let i = 0; i < sw * sh; i++) {
    const d = sdf[i];
    const diffuse = Math.max(0, Math.min(1, gx[i] * -LX + gy[i] * -LY));

    let r, g, b;
    if (d < 0) {
      // Inside geometry → fill color
      [r, g, b] = fill;
    } else if (d < borderWidth) {
      // Bevel band: fill → gradientColor, lit side stays bright, shadow side lerps to shadowColor
      const t = d / borderWidth; // 0 = inner edge, 1 = outer edge
      // bevelPeak shifts the brightness peak within the band
      const tFromPeak = Math.abs(t - bevelPeak);
      const maxDist = Math.max(bevelPeak, 1 - bevelPeak) || 1;
      const curvature = Math.pow(tFromPeak / maxDist, bevelCurvature);
      const lighting = 1 - curvature + diffuse * curvature;
      const spec = specular * Math.pow(diffuse, specularSharpness);
      const blend = Math.max(0, Math.min(1, d)); // 1-SDF-px AA at inner edge
      // lerp fill → grad outward
      const cr = fill[0] + (grad[0] - fill[0]) * t;
      const cg = fill[1] + (grad[1] - fill[1]) * t;
      const cb = fill[2] + (grad[2] - fill[2]) * t;
      // lerp shadow → color by lighting (replaces multiply-to-black)
      let lr = shadow[0] + (cr - shadow[0]) * lighting;
      let lg = shadow[1] + (cg - shadow[1]) * lighting;
      let lb = shadow[2] + (cb - shadow[2]) * lighting;
      // add specular highlight (lerp toward white)
      lr = lr + (255 - lr) * spec;
      lg = lg + (255 - lg) * spec;
      lb = lb + (255 - lb) * spec;
      r = (fill[0] * (1 - blend) + lr * blend) | 0;
      g = (fill[1] * (1 - blend) + lg * blend) | 0;
      b = (fill[2] * (1 - blend) + lb * blend) | 0;
    } else {
      // Outside bevel: grad fades into solid bg, shadow side lerps to shadowColor
      const blend = Math.max(0, Math.min(1, d - borderWidth));
      const lighting = diffuse;
      const spec = specular * Math.pow(diffuse, specularSharpness) * (1 - blend);
      let lr = shadow[0] + (grad[0] - shadow[0]) * lighting;
      let lg = shadow[1] + (grad[1] - shadow[1]) * lighting;
      let lb = shadow[2] + (grad[2] - shadow[2]) * lighting;
      lr = lr + (255 - lr) * spec;
      lg = lg + (255 - lg) * spec;
      lb = lb + (255 - lb) * spec;
      r = (lr * (1 - blend) + bg[0] * blend) | 0;
      g = (lg * (1 - blend) + bg[1] * blend) | 0;
      b = (lb * (1 - blend) + bg[2] * blend) | 0;
    }

    imgData.data[i * 4] = r;
    imgData.data[i * 4 + 1] = g;
    imgData.data[i * 4 + 2] = b;
    imgData.data[i * 4 + 3] = 255;
  }
  octx.putImageData(imgData, 0, 0);

  // ── 6. Scale up to main canvas ────────────────────────────────────────────
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, cssW, cssH);
}

// ─── O(n) 2D unsigned squared-distance transform ─────────────────────────────
// Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions", 2012.
// isSet[i] = 1 for foreground pixels. Returns Float64Array of squared L2 distances.

function _distSq2d(isSet, w, h) {
  const INF = 1e10;
  const maxDim = Math.max(w, h);
  const f = new Float64Array(maxDim);
  const d = new Float64Array(maxDim);
  const z = new Float64Array(maxDim + 1);
  const v = new Int32Array(maxDim);
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);

  // Row pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = isSet[y * w + x] ? 0 : INF;
    _dt1d(f, d, z, v, w);
    for (let x = 0; x < w; x++) tmp[y * w + x] = d[x];
  }

  // Column pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = tmp[y * w + x];
    _dt1d(f, d, z, v, h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }

  return out;
}

// 1D squared-distance transform (lower envelope of parabolas).
// f[i] = 0 for seeded pixels, INF otherwise.
// After the call, d[i] = min_j { (i-j)^2 + f[j] }.
function _dt1d(f, d, z, v, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function _drawGlyphs(rctx, font, lines, fontSize, startY, lineH, params, cssW, fillColor) {
  const scale = fontSize / font.unitsPerEm;
  for (let i = 0; i < lines.length; i++) {
    let cx = _lineStartX(lines[i], fontSize, params, font, cssW);
    const y = startY + i * lineH;
    const chars = [...lines[i]];
    const gs = chars.map((ch) => font.charToGlyph(ch));
    for (let j = 0; j < gs.length; j++) {
      const p = font.getPath(chars[j], cx, y, fontSize);
      p.fill = fillColor;
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

// ─── Tool interface ───────────────────────────────────────────────────────────────────

export function getParamLines(fmtVal) {
  return [
    '',
    '  // sdf',
    `  borderWidth: ${fmtVal(defaults.borderWidth)},     // fraction of fontSize`,
    `  bevelCurvature: ${fmtVal(defaults.bevelCurvature)},   // 0 = flat, higher = rounder`,
    `  bevelPeak: ${fmtVal(defaults.bevelPeak)},         // 0 = edge peak, 0.5 = mid ridge, 1 = outer lip`,
    `  lightAngle: ${fmtVal(defaults.lightAngle)},       // degrees clockwise from top (315 = upper-left)`,
    `  specular: ${fmtVal(defaults.specular)},         // specular highlight (0 = off)`,
    `  specularSharpness: ${fmtVal(defaults.specularSharpness)}, // tightness of highlight spot`,
    `  fillColor: ${fmtVal(defaults.fillColor)},  // text fill`,
    `  gradientColor: ${fmtVal(defaults.gradientColor)}, // bevel fades to this color`,
    `  shadowColor: ${fmtVal(defaults.shadowColor)}, // shadow side of bevel`,
    `  bgColor: ${fmtVal(defaults.bgColor)},    // background`,
  ];
}

export function normalizeParams(p) {
  return {
    borderWidth: p.borderWidth ?? defaults.borderWidth,
    bevelCurvature: p.bevelCurvature ?? defaults.bevelCurvature,
    bevelPeak: p.bevelPeak ?? defaults.bevelPeak,
    lightAngle: p.lightAngle ?? defaults.lightAngle,
    fillColor: typeof p.fillColor === 'string' ? p.fillColor : defaults.fillColor,
    gradientColor: typeof p.gradientColor === 'string' ? p.gradientColor : defaults.gradientColor,
    shadowColor: typeof p.shadowColor === 'string' ? p.shadowColor : defaults.shadowColor,
    specular: p.specular ?? defaults.specular,
    specularSharpness: p.specularSharpness ?? defaults.specularSharpness,
    bgColor: typeof p.bgColor === 'string' ? p.bgColor : defaults.bgColor,
  };
}

export function getFilenameHint(p) {
  const bw = p.borderWidth ?? defaults.borderWidth;
  const bc = p.bevelCurvature ?? defaults.bevelCurvature;
  const la = p.lightAngle ?? defaults.lightAngle;
  const fill = String(p.fillColor ?? defaults.fillColor).replace('#', '');
  const grad = String(p.gradientColor ?? defaults.gradientColor).replace('#', '');
  const bg = String(p.bgColor ?? defaults.bgColor).replace('#', '');
  return `bw${bw} bc${bc} la${la} ${fill} ${grad} ${bg}`;
}

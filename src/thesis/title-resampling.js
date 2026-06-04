import { parse as parseFont } from 'opentype.js';
import { render as resamplingRender, setCursor } from '../../tools/resampling/resampling.js';
import { layoutText, titleUrl, titleRect, blankMask } from '../../tools/title-layout.js';

const FONT_URL = new URL('../../assets/fonts/texgyretermes-regular.otf', import.meta.url).href;

const canvas = document.getElementById('title-resampling-canvas');
const ctx = canvas.getContext('2d');
let cssW = 0;
let cssH = 0;
let font = null;
let svgImage = null;
let svgRequested = false;
let svgImageSrc = null;

const MARKER_CYCLE = ['W', 'Y', 'S', 'I', 'W', 'Y', 'G'];

let markerFrameIndex = 0;

const PARAMS = {
  fontSize: null,
  leading: 0.6,
  margin: 12,
  tracking: -3,
  width: 1600,
  height: 900,
  valign: 'top',
  spacing: 10,
  marker: MARKER_CYCLE,
  markerSize: 15,
  markerColor: '#ff4c4c',
  strokeColor: '#f52121',
  strokeWidth: 5,
  bgColor: '#ffffff',
  relax: false,
  relaxSpeed: 8,
  period: 6,
  cursorRadius: 650,
  cursorScale: 2.5,
  cursorRotation: 720,
  cursorAmplitude: 1,
  cursorRepeat: false,
  cursorMode: true,
  cursorDelay: 0.08,
};

const TEXT = 'What You Say Is What You Get?';

function doRender() {
  if (!font || !cssW) return;

  const params = { ...PARAMS };
  if (cssH > cssW) {
    params.width = 210;
    params.height = 297;
  } else {
    params.margin = Math.round((PARAMS.margin / 210) * PARAMS.width);
  }
  params.margin = params.margin * (cssW / params.width);

  let scaleBase = Math.max(cssH, cssW)
  params.spacing = parseInt(scaleBase / 200);
  params.markerSize = parseInt(scaleBase / 80);
  params.strokeWidth = parseInt(scaleBase / 290);

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = params.bgColor;
  ctx.fillRect(0, 0, cssW, cssH);

  const url = titleUrl(params);
  if (url) {
    // A4 or 16:9 → use the pre-laid-out title SVG as the resampling mask.
    if (svgImageSrc !== url) {
      svgImage = null;
      svgRequested = false;
      svgImageSrc = url;
    }

    if (!svgImage) {
      if (!svgRequested) {
        svgRequested = true;
        const img = new Image();
        img.onload = () => {
          svgImage = img;
          svgRequested = false;
          doRender();
        };
        img.onerror = () => {
          svgRequested = false;
        };
        img.src = url;
      }
      return;
    }

    const rect = titleRect(svgImage, params, cssW, cssH);
    const maskCanvas = blankMask(cssW, cssH);
    maskCanvas.getContext('2d').drawImage(svgImage, rect.x, rect.y, rect.w, rect.h);

    resamplingRender(ctx, font, canvas, {
      maskCanvas,
      lines: [],
      fontSize: 0,
      startY: 0,
      lineH: 0,
      params,
      cssW,
      cssH,
    });
    return;
  }

  // Any other aspect ratio → typeset the title with opentype.
  const { lines, fontSize, startY, lineH } = layoutText(font, TEXT, params, cssW, cssH);
  resamplingRender(ctx, font, canvas, {
    lines,
    fontSize,
    startY,
    lineH,
    params,
    cssW,
    cssH,
  });
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  cssW = canvas.offsetWidth;
  if (!cssW) return;
  // Derive height from the intended aspect ratio so the canvas is always correct.
  const portrait = cssW < window.innerHeight;
  cssH = portrait ? Math.round(cssW * (297 / 210)) : Math.round(cssW * (9 / 16));
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  doRender();
}

new ResizeObserver(resize).observe(canvas);

window.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  setCursor(e.clientX - r.left, e.clientY - r.top);
});

async function init() {
  const fontBuffer = await fetch(FONT_URL).then((r) => r.arrayBuffer());
  font = parseFont(fontBuffer);
  resize();
}

init().catch(console.error);

import { parse as parseFont } from 'opentype.js';
import { render as resamplingRender, setCursor } from '../../tools/resampling/resampling.js';

const FONT_URL = new URL('../../assets/fonts/texgyretermes-regular.otf', import.meta.url).href;
const TITLE_SVG_URL = new URL('../../assets/svg/title_layout.svg', import.meta.url).href;

const canvas = document.getElementById('title-resampling-canvas');
const ctx = canvas.getContext('2d');
let cssW = 0;
let cssH = 0;
let font = null;
let svgImage = null;

const MARKER_CYCLE = ['W', 'Y', 'S', 'I', 'W', 'Y', 'G'];

let markerFrameIndex = 0;

const PARAMS = {
  fontSize: null,
  leading: 0.6,
  margin: 12,
  tracking: -3,
  width: 300,
  height: 300,
  valign: 'top',
  spacing: 10,
  marker: MARKER_CYCLE,
  markerSize: 15,
  markerColor: '#ff4c4c',
  strokeColor: '#3366ff',
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

function buildMaskCanvas() {
  const m = PARAMS.margin * (cssW / PARAMS.width);
  const svgW = cssW - m * 2;
  const svgH = (svgImage.naturalHeight / svgImage.naturalWidth) * svgW;
  const svgY =
    PARAMS.valign === 'bottom'
      ? cssH - m - svgH
      : PARAMS.valign === 'center'
        ? (cssH - svgH) / 2
        : m;

  const mc = document.createElement('canvas');
  mc.width = cssW;
  mc.height = cssH;
  const mctx = mc.getContext('2d');
  mctx.fillStyle = '#fff';
  mctx.fillRect(0, 0, cssW, cssH);
  mctx.drawImage(svgImage, m, svgY, svgW, svgH);
  return mc;
}

function doRender() {
  if (!font || !svgImage || !cssW) return;
  const maskCanvas = buildMaskCanvas();
  resamplingRender(ctx, font, canvas, {
    maskCanvas,
    lines: [],
    fontSize: 0,
    startY: 0,
    lineH: 0,
    params: { ...PARAMS },
    cssW,
    cssH,
  });
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.offsetWidth;
  if (!size) return;
  cssW = size;
  cssH = size;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
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

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = TITLE_SVG_URL;
  });
  svgImage = img;

  resize();
}

init().catch(console.error);

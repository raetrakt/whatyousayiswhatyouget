import * as d3 from './d3.js';
import { state, editorState } from './state.js';
import { makeSnapshot } from './utils.js';
import { buildRevealLevels, pushBatchOutward, runOnboardingReveal } from './onboarding.js';
import { loadData } from './data.js';
import { createRenderer } from './render.js';
import { createGraphSimulation, bindSimulationTick, createDrag } from './simulation.js';
// import { initRecording } from './record.js';

let isRefreshing = false;
let lastSnapshot = '';
let hasRunOnboarding = false;
let preloadedMediaPaths = new Set();

const svg = d3.select('svg');
const width = window.innerWidth;
const height = window.innerHeight;

const isSafari =
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
  (/AppleWebKit/i.test(navigator.userAgent) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/i.test(navigator.userAgent));

if (isSafari) {
  document.body.classList.add('is-safari');
}

const container = svg.append('g');

const isMobile = window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;

const zoom = d3
  .zoom()
  .scaleExtent([isMobile ? 0.1 : 0.2, isMobile ? 2 : 2])
  .wheelDelta((event) => {
    if (!event.ctrlKey) {
      // Normal scroll wheel — unchanged D3 default.
      return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002);
    }
    // Pinch-to-zoom (ctrlKey=true on both Chrome and Firefox).
    // Chrome fires few events with large deltaY (50-300); Firefox fires many
    // with small deltaY (1-10). Use a multiplier tuned for Firefox's small
    // values, then clamp the step size so Chrome's large deltas don't jump.
    const raw = -event.deltaY * 0.008;
    return Math.sign(raw) * Math.min(Math.abs(raw), 0.12);
  })
  .on('zoom', (event) => {
    container.attr('transform', event.transform);
  });

svg.call(zoom);
svg.call(
  zoom.transform,
  d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(isMobile ? 0.2 : 0.6)
    .translate(-width / 2, -height / 2),
);
if (!isSafari) {
  // --- Smooth middle-mouse panning ---
  let isMiddlePanning = false;
  let lastPanPos = null;
  let panVelocity = { x: 0, y: 0 };
  let targetPanVelocity = { x: 0, y: 0 };
  // Raw mouse velocity accumulated between animation frames.
  // Only consumed (and reset) inside animatePan so easing runs at rAF rate.
  let mouseVelAccum = { x: 0, y: 0 };
  let mouseVelFrames = 0;
  let panAnimationId = null;
  let lastFrameTime = null;
  // How fast the target eases toward mouse input per frame (~60 fps).
  // 0.08 ≈ 0.5 s time-constant — smooth enough for circular orbiting.
  const PAN_TARGET_STEERING = 0.08;
  // How fast actual velocity follows the target — slightly slower.
  const PAN_STEERING = 0.055;
  const PAN_RELEASE_FRICTION = 0.9;
  const PAN_VELOCITY_SCALE = 60;

  // Get current transform
  function getCurrentTransform() {
    const t = d3.zoomTransform(svg.node());
    return t;
  }

  // Set transform
  function setCurrentTransform(t) {
    svg.call(zoom.transform, t);
  }

  function animatePan() {
    if (!isMiddlePanning && Math.abs(panVelocity.x) < 0.01 && Math.abs(panVelocity.y) < 0.01) {
      panAnimationId = null;
      return;
    }
    const now = performance.now();
    const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
    lastFrameTime = now;

    if (dt > 0) {
      if (isMiddlePanning) {
        // If the mouse moved since the last frame, ease the target toward the
        // averaged mouse velocity.  If the mouse was still, the target holds
        // its value — so the graph keeps coasting in the last steered direction.
        if (mouseVelFrames > 0) {
          const avgX = (mouseVelAccum.x / mouseVelFrames) * PAN_VELOCITY_SCALE;
          const avgY = (mouseVelAccum.y / mouseVelFrames) * PAN_VELOCITY_SCALE;
          targetPanVelocity.x += (avgX - targetPanVelocity.x) * PAN_TARGET_STEERING;
          targetPanVelocity.y += (avgY - targetPanVelocity.y) * PAN_TARGET_STEERING;
          mouseVelAccum.x = 0;
          mouseVelAccum.y = 0;
          mouseVelFrames = 0;
        }
        // Velocity follows the target with a second layer of easing.
        panVelocity.x += (targetPanVelocity.x - panVelocity.x) * PAN_STEERING;
        panVelocity.y += (targetPanVelocity.y - panVelocity.y) * PAN_STEERING;
      } else {
        panVelocity.x *= PAN_RELEASE_FRICTION;
        panVelocity.y *= PAN_RELEASE_FRICTION;
      }

      const t = getCurrentTransform();
      const next = t.translate(panVelocity.x * dt, panVelocity.y * dt);
      setCurrentTransform(next);
    }
    panAnimationId = requestAnimationFrame(animatePan);
  }

  svg.on('mousedown.middlepan', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    isMiddlePanning = true;
    lastPanPos = { x: event.clientX, y: event.clientY };
    panVelocity = { x: 0, y: 0 };
    targetPanVelocity = { x: 0, y: 0 };
    mouseVelAccum = { x: 0, y: 0 };
    mouseVelFrames = 0;
    lastFrameTime = null;
    if (!panAnimationId) animatePan();
  });

  svg.on('mousemove.middlepan', (event) => {
    if (!isMiddlePanning) return;
    event.preventDefault();
    const dx = event.clientX - lastPanPos.x;
    const dy = event.clientY - lastPanPos.y;
    lastPanPos = { x: event.clientX, y: event.clientY };
    // Accumulate raw deltas; the animation loop reads and resets this each frame
    // so easing always runs at a stable rAF rate, not at mousemove rate.
    mouseVelAccum.x += dx;
    mouseVelAccum.y += dy;
    mouseVelFrames += 1;
    if (!panAnimationId) animatePan();
  });

  svg.on('mouseup.middlepan', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    isMiddlePanning = false;
    lastPanPos = null;
    // Let velocity decay for smooth stop
    if (!panAnimationId) animatePan();
  });

  // Stop panning if mouse leaves window
  window.addEventListener('blur', () => {
    isMiddlePanning = false;
    lastPanPos = null;
  });
}
svg.on('dblclick.zoom', null); // allow dblclick on links for delete in edit mode

const simulation = createGraphSimulation({ width, height });
const dragBehavior = createDrag(simulation);

const renderer = createRenderer({
  container,
  simulation,
  state,
  editorState,
  dragBehavior,
  onConnect: () => {},
  onRemoveConnection: () => {},
});

bindSimulationTick(simulation, {
  state,
  getSelections: renderer.getSelections,
});

async function preloadWorkImages(works, { timeoutMs = 3500 } = {}) {
  const paths = [
    ...new Set((works ?? []).map((w) => String(w.media_path ?? '').trim()).filter(Boolean)),
  ];
  const loaded = new Set();

  const jobs = paths.map(
    (src) =>
      new Promise((resolve) => {
        const img = new Image();
        let done = false;

        const finish = (ok) => {
          if (done) return;
          done = true;
          if (ok) loaded.add(src);
          resolve();
        };

        const timer = setTimeout(() => finish(false), timeoutMs);
        img.onload = () => {
          clearTimeout(timer);
          finish(true);
        };
        img.onerror = () => {
          clearTimeout(timer);
          finish(false);
        };

        img.src = src;
        if (img.complete) {
          clearTimeout(timer);
          finish(!!img.naturalWidth && !!img.naturalHeight);
        } else if (typeof img.decode === 'function') {
          img.decode().then(
            () => {
              clearTimeout(timer);
              finish(true);
            },
            () => {
              // Keep onload/onerror path for compatibility.
            },
          );
        }
      }),
  );

  await Promise.allSettled(jobs);
  return loaded;
}

async function refreshDataAndRender({ force = false } = {}) {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    const ok = await loadData(state);
    if (!ok) return;

    const next = makeSnapshot(state);
    if (!force && next === lastSnapshot) return;
    lastSnapshot = next;

    const preloadPromise = preloadWorkImages(state.works).then((loaded) => {
      preloadedMediaPaths = loaded;
      renderer.setPreloadedMedia({ paths: preloadedMediaPaths });
      return loaded;
    });

    if (!hasRunOnboarding) {
      await runOnboardingReveal({
        simulation,
        renderer,
        width,
        height,
        preloadPromise,
      });
      hasRunOnboarding = true;
      return;
    }

    await preloadPromise;

    renderer.setVisibility({ nodeIds: null });
    renderer.renderGraph();
    await renderer.waitForImages({ staggerMs: 0 });
    renderer.measureNodes();
    simulation.alpha(1).restart();
  } finally {
    isRefreshing = false;
  }
}

await document.fonts.ready;
await refreshDataAndRender({ force: true });

function replayOnboarding() {
  // Reset all node positions so they collapse back to center before re-revealing
  state.nodes.forEach((n) => {
    n.x = width / 2;
    n.y = height / 2;
    n.vx = 0;
    n.vy = 0;
  });
  hasRunOnboarding = false;
  refreshDataAndRender({ force: true });
}

// initRecording({ replayOnboarding });

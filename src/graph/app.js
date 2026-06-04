import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { state, editorState } from './state.js';
import {
  linkKey,
  parseNodeId,
  makeSnapshot,
  hasConceptRelation,
  hasWorkConceptRelation,
  hash01,
  sleep,
} from './utils.js';
import { buildRevealLevels, pushBatchOutward, runOnboardingReveal } from './onboarding.js';
import { loadData } from './data.js';
import { createRenderer } from './render.js';
import { createGraphSimulation, bindSimulationTick, createDrag } from './simulation.js';
// import { initRecording } from './record.js';

const SUPABASE_URL = 'https://rowvcuuqebamsxndzhxn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LBTefqV0J1vkvYXriS5gUA_AychNVUb';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

const zoom = d3
  .zoom()
  .scaleExtent([0.2, 2])
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
    .scale(.6) // your desired scale < 1
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
  onConnect: addConnection,
  onRemoveConnection: removeConnection,
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
    const ok = await loadData(supabase, state);
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

// ADD: restore missing functions used by bindEditHandlers()

async function addConnection(a, b) {
  const A = parseNodeId(a.id);
  const B = parseNodeId(b.id);

  let srcId = null;
  let dstId = null;
  let insert = null;
  let localApply = null;
  let alreadyExists = false;

  if (A.kind === 'c' && B.kind === 'c') {
    srcId = `c-${A.raw}`;
    dstId = `c-${B.raw}`;
    alreadyExists = hasConceptRelation(state, A.raw, B.raw);
    insert = () =>
      supabase.from('concept_relations').insert({ from_concept: A.raw, to_concept: B.raw });
    localApply = () => state.relations.push({ from_concept: A.raw, to_concept: B.raw });
  } else if (A.kind === 'w' && B.kind === 'c') {
    srcId = `w-${A.raw}`;
    dstId = `c-${B.raw}`;
    alreadyExists = hasWorkConceptRelation(state, A.raw, B.raw);
    insert = () => supabase.from('work_concept_relations').insert({ work: A.raw, concept: B.raw });
    localApply = () => state.workConcepts.push({ work: A.raw, concept: B.raw });
  } else if (A.kind === 'c' && B.kind === 'w') {
    srcId = `w-${B.raw}`;
    dstId = `c-${A.raw}`;
    alreadyExists = hasWorkConceptRelation(state, B.raw, A.raw);
    insert = () => supabase.from('work_concept_relations').insert({ work: B.raw, concept: A.raw });
    localApply = () => state.workConcepts.push({ work: B.raw, concept: A.raw });
  } else {
    alert('Unsupported connection type.');
    return;
  }

  const k = `${srcId}->${dstId}`;
  const isPreviouslyRemoved = editorState.removedLinkKeys.has(k);

  if (alreadyExists && !isPreviouslyRemoved) return;

  const { error } = await insert();
  if (error) return alert(error.message);

  editorState.removedLinkKeys.delete(k);
  editorState.addedLinkKeys.add(k);

  if (!alreadyExists) localApply();

  renderer.renderGraph();
  await renderer.waitForImages({ staggerMs: 0 });
  renderer.measureNodes();
  simulation.alpha(0.6).restart();
}

async function removeConnection(d) {
  const k = linkKey(d);
  if (editorState.removedLinkKeys.has(k)) return;

  const s = parseNodeId(d.source.id);
  const t = parseNodeId(d.target.id);
  let q = null;

  if (s.kind === 'c' && t.kind === 'c') {
    q = supabase
      .from('concept_relations')
      .delete()
      .eq('from_concept', s.raw)
      .eq('to_concept', t.raw);
  } else if (s.kind === 'w' && t.kind === 'c') {
    q = supabase.from('work_concept_relations').delete().eq('work', s.raw).eq('concept', t.raw);
  } else if (s.kind === 'c' && t.kind === 'w') {
    q = supabase.from('work_concept_relations').delete().eq('work', t.raw).eq('concept', s.raw);
  }

  if (!q) return alert('Unsupported connection type.');
  const { error } = await q;
  if (error) return alert(error.message);

  editorState.addedLinkKeys.delete(k);
  editorState.removedLinkKeys.add(k);
  renderer.paintSelectedLink();
}

async function ensureSignedIn() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return true;

  const email = prompt('Admin email:');
  if (!email) return false;
  const password = prompt('Admin password:');
  if (!password) return false;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    alert(`Login failed: ${error.message}`);
    return false;
  }
  return true;
}

async function toggleEditing() {
  if (!editorState.enabled) {
    const ok = await ensureSignedIn();
    if (!ok) return;
  }
  editorState.enabled = !editorState.enabled;
  editorState.selectedNode = null;
  editorState.selectedLinkKey = null;
  renderer.paintSelectedNode();
  renderer.paintSelectedLink();
  document.body.classList.toggle('editing-mode', editorState.enabled);
}

// ADD: non-reserved shortcuts for edit mode
// Ctrl+Shift+E (Windows/Linux), Cmd+Shift+E (macOS), or F2 (fallback)
window.addEventListener('keydown', async (event) => {
  const key = event.key?.toLowerCase?.() ?? '';
  const isCmdOrCtrl = event.metaKey || event.ctrlKey;

  const toggleByChord = isCmdOrCtrl && event.shiftKey && key === 'e';
  const toggleByF2 = event.key === 'F2';

  if (toggleByChord || toggleByF2) {
    event.preventDefault();
    await toggleEditing();
  }
});

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

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { state, editorState } from './state.js';
import {
  linkKey,
  parseNodeId,
  makeSnapshot,
  hasConceptRelation,
  hasWorkConceptRelation,
} from './utils.js';
import { loadData } from './data.js';
import { createRenderer } from './render.js';
import { createGraphSimulation, bindSimulationTick, createDrag } from './simulation.js';

const SUPABASE_URL = 'https://rowvcuuqebamsxndzhxn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LBTefqV0J1vkvYXriS5gUA_AychNVUb';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let isRefreshing = false;
let lastSnapshot = '';
let hasRunOnboarding = false;
let preloadedMediaPaths = new Set();

const ONBOARDING_BATCH_DELAY_MS = 300;

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
  .on('zoom', (event) => {
    container.attr('transform', event.transform);
  });

svg.call(zoom);
if (!isSafari) {
svg.call(zoom.transform,
  d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(0.7)  // your desired scale < 1
    .translate(-width / 2, -height / 2)
);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash01(input) {
  let h = 2166136261;
  const s = String(input ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

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

function buildRevealLevels() {
  const main = state.concepts.find((c) => c.type === 'main');
  if (!main) return { rootId: null, levels: [] };

  const rootId = `c-${main.id}`;

  const allNodeIds = [
    ...state.concepts.map((c) => `c-${c.id}`),
    ...state.works.map((w) => `w-${w.id}`),
  ];

  const adjacency = new Map(allNodeIds.map((id) => [id, new Set()]));
  const addEdge = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  };

  state.relations.forEach((r) => addEdge(`c-${r.from_concept}`, `c-${r.to_concept}`));
  state.workConcepts.forEach((r) => addEdge(`w-${r.work}`, `c-${r.concept}`));

  const visited = new Set([rootId]);
  const parentById = new Map();
  let frontier = [rootId];
  const levels = [];

  while (frontier.length) {
    const next = [];
    frontier.forEach((id) => {
      (adjacency.get(id) ?? []).forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        parentById.set(neighbor, id);
        next.push(neighbor);
      });
    });

    if (!next.length) break;
    levels.push(next.map((id) => ({ id, parentId: parentById.get(id) ?? rootId })));
    frontier = next;
  }

  const remaining = allNodeIds.filter((id) => !visited.has(id) && id !== rootId);
  if (remaining.length) {
    levels.push(remaining.map((id) => ({ id, parentId: rootId })));
  }

  return { rootId, levels };
}

function pushBatchOutward(batch, rootId, levelIndex) {
  const root = state.nodes.find((n) => n.id === rootId);
  if (!root) return;

  if (!Number.isFinite(root.x) || !Number.isFinite(root.y)) {
    root.x = width / 2;
    root.y = height / 2;
  }

  const rootX = Number.isFinite(root.x) ? root.x : width / 2;
  const rootY = Number.isFinite(root.y) ? root.y : height / 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const stepDistance = 120;

  batch.forEach((entry, i) => {
    const { id, parentId } = entry;
    const n = state.nodes.find((node) => node.id === id);
    if (!n) return;

    const parent = state.nodes.find((node) => node.id === parentId) ?? root;
    const px = Number.isFinite(parent?.x) ? parent.x : rootX;
    const py = Number.isFinite(parent?.y) ? parent.y : rootY;

    const jitter = hash01(id);
    let baseAngle = Math.atan2(py - rootY, px - rootX);
    if (
      !Number.isFinite(baseAngle) ||
      (Math.abs(px - rootX) < 0.001 && Math.abs(py - rootY) < 0.001)
    ) {
      baseAngle = jitter * Math.PI * 2 + i * golden * 0.7;
    }

    const spread = (jitter - 0.5) * 0.7;
    const angle = baseAngle + spread;
    const radius = stepDistance + jitter * 26 + (i % 2) * 10;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    n.x = px + dx * radius;
    n.y = py + dy * radius;
    // Keep reveal calm: place directly and avoid additional kick velocity.
    n.vx = 0;
    n.vy = 0;
  });
}

async function runOnboardingReveal({ preloadPromise = null } = {}) {
  const originalVelocityDecay = simulation.velocityDecay();
  simulation.velocityDecay(0.62);
  try {
    const { rootId, levels } = buildRevealLevels();
    if (!rootId) {
      renderer.setVisibility({ nodeIds: null });
      renderer.renderGraph();
      await renderer.waitForImages({ staggerMs: 0 });
      renderer.measureNodes();
      simulation.alpha(1).restart();
      return;
    }

    const visible = new Set([rootId]);

    const onboardingCollision = {
      enableCollision: true,
      collisionPadding: 2,
      collisionStrength: 0.22,
      collisionIterations: 1,
    };

    renderer.setVisibility({ nodeIds: visible });
    renderer.renderGraph();
    renderer.measureNodes(onboardingCollision);

    const rootNode = state.nodes.find((n) => n.id === rootId);
    if (rootNode) {
      rootNode.x = width / 2;
      rootNode.y = height / 2;
      rootNode.vx = 0;
      rootNode.vy = 0;
      rootNode.fx = width / 2;
      rootNode.fy = height / 2;
    }

    simulation.alpha(0.18).restart();

    for (let i = 0; i < levels.length; i += 1) {
      await sleep(ONBOARDING_BATCH_DELAY_MS);

      const batch = levels[i];
      batch.forEach(({ id }) => visible.add(id));

      renderer.setVisibility({ nodeIds: visible });
      renderer.renderGraph();
      renderer.measureNodes(onboardingCollision);

      pushBatchOutward(batch, rootId, i + 1);
    }

    if (preloadPromise) {
      preloadedMediaPaths = await preloadPromise;
      renderer.setPreloadedMedia({ paths: preloadedMediaPaths });
    }

    if (rootNode) {
      rootNode.fx = null;
      rootNode.fy = null;
    }

    renderer.setVisibility({ nodeIds: null });
    renderer.renderGraph();
    await renderer.waitForImages({ staggerMs: 0 });
    renderer.measureNodes();
    simulation.alpha(1).restart();
  } finally {
    simulation.velocityDecay(originalVelocityDecay);
  }
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
      await runOnboardingReveal({ preloadPromise });
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

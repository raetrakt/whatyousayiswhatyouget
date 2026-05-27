import { hash01, sleep } from './utils.js';
import { state } from './state.js';

// Returns { rootId, levels } for onboarding reveal
export function buildRevealLevels() {
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

// Pushes a batch of nodes outward from root/parent
export function pushBatchOutward(batch, rootId, levelIndex, width, height) {
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
    n.vx = 0;
    n.vy = 0;
  });
}

// Orchestrates the onboarding reveal animation
export async function runOnboardingReveal({
  simulation,
  renderer,
  width,
  height,
  preloadPromise = null,
  ONBOARDING_BATCH_DELAY_MS = 1000,
} = {}) {
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
      pushBatchOutward(batch, rootId, i + 1, width, height);
    }
    if (preloadPromise) {
      renderer.setPreloadedMedia({ paths: await preloadPromise });
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

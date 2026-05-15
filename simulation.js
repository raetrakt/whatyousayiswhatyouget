import { getNodeId } from './utils.js';

export function createGraphSimulation({ width, height }) {
  return d3
    .forceSimulation([])
    .force(
      'link',
      d3
        .forceLink([])
        .id((d) => d.id)
        .distance(250)
        .strength(1)
        .iterations(2),
    )
    .force('charge', d3.forceManyBody().strength(-280))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .alphaDecay(0.02)
    .velocityDecay(0.3);
}

function buildInvisibleMainLinks(state) {
  const nodes = state.nodes ?? [];
  const links = state.links ?? [];
  const root = nodes.find((n) => n?.type === 'main');
  if (!root?.id) return [];

  const connected = new Set();
  links.forEach((l) => {
    const s = getNodeId(l.source);
    const t = getNodeId(l.target);
    if (s != null) connected.add(s);
    if (t != null) connected.add(t);
  });

  const prev = new Map((state.__autoMainLinks ?? []).map((l) => [getNodeId(l.target), l]));

  return nodes
    .filter((n) => n?.id != null && n.id !== root.id && !connected.has(n.id))
    .map((n) => {
      const existing = prev.get(n.id);
      if (existing) {
        existing.source = root.id;
        existing.target = n.id;
        existing.type = 'main';
        existing.invisible = true;
        existing.__autoMainLink = true;
        return existing;
      }
      return {
        source: root.id,
        target: n.id,
        type: 'main',
        invisible: true,
        __autoMainLink: true,
      };
    });
}

function syncSimulationLinks(simulation, state) {
  const linkForce = simulation.force('link');
  if (!linkForce) return;

  const activeNodes = simulation.nodes() ?? [];
  const activeIds = new Set(activeNodes.map((n) => getNodeId(n)));

  const visibleLinks = (state.links ?? []).filter((l) => {
    const s = getNodeId(l.source);
    const t = getNodeId(l.target);
    return activeIds.has(s) && activeIds.has(t);
  });

  const autoMainLinks = buildInvisibleMainLinks(state);
  const visibleAutoMainLinks = autoMainLinks.filter((l) => {
    const s = getNodeId(l.source);
    const t = getNodeId(l.target);
    return activeIds.has(s) && activeIds.has(t);
  });

  state.__autoMainLinks = visibleAutoMainLinks;
  linkForce.links([...visibleLinks, ...visibleAutoMainLinks]);
}

export function bindSimulationTick(simulation, { state, getSelections }) {
  simulation.on('tick', () => {
    syncSimulationLinks(simulation, state);

    const { link, linkHit, node } = getSelections();

    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    linkHit
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('x', (d) => d.x - (d.w ?? 80) / 2).attr('y', (d) => d.y - (d.h ?? 40) / 2);
  });
}

export function createDrag(simulation) {
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  return d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended);
}

import * as d3 from './d3.js';
import { linkKey, getNodeId } from './utils.js';

export function createRenderer({
  container,
  simulation,
  state,
  editorState,
  dragBehavior,
  onConnect,
  onRemoveConnection,
}) {
  const linkLayer = container.append('g');
  const linkHitLayer = container.append('g');
  const nodeLayer = container.append('g');

  let link = linkLayer.selectAll('line');
  let linkHit = linkHitLayer.selectAll('line');
  let node = nodeLayer.selectAll('foreignObject');
  let nodeDiv = node.selectAll('div');
  let visibleNodeIds = null;
  let preloadedMediaPaths = new Set();

  const workModal = document.getElementById('work-modal');
  const workModalPanel = document.getElementById('work-modal-panel');
  const workModalImage = document.getElementById('work-modal-image');
  const workModalTitle = document.getElementById('work-modal-title');
  const workModalAuthor = document.getElementById('work-modal-author');
  const workModalYear = document.getElementById('work-modal-year');
  const workModalSource = document.getElementById('work-modal-source');
  const workModalClassification = document.getElementById('work-modal-classification');

  function getWorkClassificationText(workNode) {
    const workId = String(workNode?.id ?? '').replace(/^w-/, '');
    if (!workId) return 'Unclassified';

    const conceptById = new Map(state.concepts.map((c) => [String(c.id), c]));
    const mainIds = new Set(
      state.concepts.filter((c) => c.type === 'main').map((c) => String(c.id)),
    );

    const neighborsById = new Map();
    const addNeighbor = (a, b) => {
      if (!neighborsById.has(a)) neighborsById.set(a, []);
      neighborsById.get(a).push(b);
    };

    // Treat concept relations as an undirected graph for classification lookup,
    // then choose the shortest path from a linked concept to any main node.
    state.relations.forEach((rel) => {
      const a = String(rel.from_concept);
      const b = String(rel.to_concept);
      addNeighbor(a, b);
      addNeighbor(b, a);
    });

    function shortestPathToMain(startId) {
      if (mainIds.has(startId)) return [startId];

      const visited = new Set([startId]);
      const prev = new Map();
      const queue = [startId];
      let foundMain = null;

      while (queue.length && !foundMain) {
        const current = queue.shift();
        const neighbors = [...new Set(neighborsById.get(current) ?? [])].sort((a, b) => {
          const nameA = conceptById.get(a)?.name ?? '';
          const nameB = conceptById.get(b)?.name ?? '';
          return nameA.localeCompare(nameB);
        });

        for (const nextId of neighbors) {
          if (visited.has(nextId)) continue;
          visited.add(nextId);
          prev.set(nextId, current);

          if (mainIds.has(nextId)) {
            foundMain = nextId;
            break;
          }

          queue.push(nextId);
        }
      }

      if (!foundMain) return [];

      const pathMainToStart = [foundMain];
      let cursor = foundMain;

      while (prev.has(cursor)) {
        cursor = prev.get(cursor);
        pathMainToStart.push(cursor);
      }

      if (pathMainToStart[pathMainToStart.length - 1] !== startId) return [];
      return pathMainToStart;
    }

    const linkedConceptIds = state.workConcepts
      .filter((rel) => String(rel.work) === workId)
      .map((rel) => String(rel.concept));

    if (!linkedConceptIds.length) return 'Unclassified';

    const classifications = [];

    linkedConceptIds.forEach((conceptId) => {
      const path = shortestPathToMain(conceptId);

      if (!path.length) {
        const fallbackName = conceptById.get(conceptId)?.name;
        if (fallbackName) classifications.push(fallbackName);
        return;
      }

      const displayPath = mainIds.has(path[0]) ? path.slice(1) : path;
      const names = displayPath.map((id) => conceptById.get(id)?.name).filter(Boolean);
      if (names.length) classifications.push(names.join(' > '));
    });

    const uniqueClassifications = [...new Set(classifications)];
    if (!uniqueClassifications.length) return 'Unclassified';

    return uniqueClassifications.join(' and ');
  }

  function closeWorkModal() {
    if (!workModal) return;
    workModal.classList.remove('is-open');
    workModal.setAttribute('aria-hidden', 'true');
    if (workModalImage) {
      workModalImage.src = '';
    }
  }

  function openWorkModal(workNode) {
    if (
      !workModal ||
      !workModalImage ||
      !workModalTitle ||
      !workModalAuthor ||
      !workModalYear ||
      !workModalSource ||
      !workModalClassification
    ) {
      return;
    }

    const title = workNode?.name?.trim() || 'Untitled';
    const author = workNode?.author?.trim() || 'Unknown author';
    const year =
      workNode?.year != null && String(workNode.year).trim() !== ''
        ? String(workNode.year)
        : 'Unknown year';
    const sourceUrl = workNode?.source_url?.trim() || '';

    workModalImage.src = workNode?.media_path || '';
    workModalImage.alt = title;
    workModalTitle.textContent = title;
    workModalAuthor.textContent = author;
    workModalYear.textContent = year;
    workModalClassification.textContent = getWorkClassificationText(workNode);

    if (sourceUrl) {
      workModalSource.href = sourceUrl;
      workModalSource.textContent = sourceUrl;
      workModalSource.classList.remove('is-disabled');
      workModalSource.removeAttribute('aria-disabled');
      workModalSource.tabIndex = 0;
    } else {
      workModalSource.removeAttribute('href');
      workModalSource.textContent = 'No source available';
      workModalSource.classList.add('is-disabled');
      workModalSource.setAttribute('aria-disabled', 'true');
      workModalSource.tabIndex = -1;
    }

    workModal.classList.add('is-open');
    workModal.setAttribute('aria-hidden', 'false');
  }

  if (workModal && workModalPanel) {
    workModal.addEventListener('click', closeWorkModal);
    workModalPanel.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeWorkModal();
    });
  }

  function readCssPxVar(name, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function getWorkStyleConfig() {
    const targetArea = readCssPxVar('--work-img-target-area', 9000);
    const pad = readCssPxVar('--work-node-padding', 6);
    return { targetArea, padTotal: pad * 2 };
  }

  function fitWorkImageSize(img, { targetArea, padTotal }) {
    const nw = img?.naturalWidth || 0;
    const nh = img?.naturalHeight || 0;
    if (!nw || !nh) {
      const side = Math.ceil(Math.sqrt(targetArea));
      return { imgW: side, imgH: side, w: side + padTotal, h: side + padTotal };
    }

    const scale = Math.sqrt(targetArea / (nw * nh));
    const imgW = Math.ceil(nw * scale);
    const imgH = Math.ceil(nh * scale);

    return {
      imgW,
      imgH,
      w: imgW + padTotal,
      h: imgH + padTotal,
    };
  }

  function waitForImageReady(img, { timeoutMs = 3000 } = {}) {
    if (!img) return Promise.resolve();
    if (img.complete) return Promise.resolve();

    return new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve();
      };

      img.addEventListener('load', finish, { once: true });
      img.addEventListener('error', finish, { once: true });
      timer = setTimeout(finish, timeoutMs);
      img.decode?.().then(finish).catch(finish);
    });
  }

  function buildDerivedData() {
    const desired = [
      ...state.concepts.map((c) => ({ id: `c-${c.id}`, name: c.name, type: c.type })),
      ...state.works.map((w) => ({
        id: `w-${w.id}`,
        name: w.title ?? '',
        type: 'work',
        media_path: w.media_path,
        author: w.author,
        year: w.year,
        source_url: w.source_url,
      })),
    ];

    const prevById = new Map(simulation.nodes().map((n) => [n.id, n]));
    state.nodes = desired.map((n) => {
      const prev = prevById.get(n.id);
      if (!prev) return n;
      prev.name = n.name;
      prev.type = n.type;
      prev.media_path = n.media_path;
      prev.author = n.author;
      prev.year = n.year;
      prev.source_url = n.source_url;
      return prev;
    });

    const conceptLinks = state.relations.map((r) => ({
      source: `c-${r.from_concept}`,
      target: `c-${r.to_concept}`,
    }));
    const workLinks = state.workConcepts.map((r) => ({
      source: `w-${r.work}`,
      target: `c-${r.concept}`,
    }));
    state.links = [...conceptLinks, ...workLinks];
  }

  function paintSelectedNode() {
    nodeDiv.classed('selected', (d) => editorState.selectedNode?.id === d.id);
  }

  function paintSelectedLink() {
    link
      .classed('selected', (d) => editorState.selectedLinkKey === linkKey(d))
      .classed('added', (d) => editorState.addedLinkKeys.has(linkKey(d)))
      .classed('removed', (d) => editorState.removedLinkKeys.has(linkKey(d)));
  }

  function setVisibility({ nodeIds = null } = {}) {
    visibleNodeIds = nodeIds ? new Set(nodeIds) : null;
  }

  function setPreloadedMedia({ paths = null } = {}) {
    preloadedMediaPaths = paths instanceof Set ? paths : new Set();
  }

  function isWorkMediaReady(d) {
    if (d.type !== 'work') return true;
    const mediaPath = String(d.media_path ?? '').trim();
    return !!mediaPath && preloadedMediaPaths.has(mediaPath);
  }

  function getVisibleNodes() {
    if (!visibleNodeIds) return state.nodes;
    return state.nodes.filter((n) => visibleNodeIds.has(n.id));
  }

  function getVisibleLinks() {
    if (!visibleNodeIds) return state.links;

    return state.links.filter((l) => {
      const s = getNodeId(l.source);
      const t = getNodeId(l.target);
      return visibleNodeIds.has(s) && visibleNodeIds.has(t);
    });
  }

  const toolLinks = {
    'Path Resampling': '/tools/?tool=resampling',
    'Reaction Diffusion': '/tools/?tool=rd',
    'Signed Distance Field': '/tools/?tool=sdf',
    'Falling Sand Simulation': '/tools/?tool=sand',
    Quadtree: '/tools/?tool=quadtree',
  };

  function bindEditHandlers() {
    node.on('click', async (event, d) => {
      if (!editorState.enabled) {
        if (d.type === 'work') {
          event.preventDefault();
          event.stopPropagation();
          openWorkModal(d);
          return;
        }
        const toolUrl = toolLinks[d.name];
        if (toolUrl) {
          event.preventDefault();
          event.stopPropagation();
          location.href = toolUrl;
          return;
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!editorState.selectedNode) {
        editorState.selectedNode = d;
        paintSelectedNode();
        return;
      }

      if (editorState.selectedNode.id === d.id) {
        editorState.selectedNode = null;
        paintSelectedNode();
        return;
      }

      const first = editorState.selectedNode;
      editorState.selectedNode = null;
      paintSelectedNode();
      await onConnect(first, d);
    });

    linkHit.on('click', (event, d) => {
      if (!editorState.enabled) return;
      event.preventDefault();
      event.stopPropagation();

      const k = linkKey(d);
      editorState.selectedLinkKey = editorState.selectedLinkKey === k ? null : k;
      paintSelectedLink();
    });

    linkHit.on('dblclick', async (event, d) => {
      if (!editorState.enabled) return;
      event.preventDefault();
      event.stopPropagation();
      await onRemoveConnection(d);
    });
  }

  function renderGraph() {
    buildDerivedData();

    const visibleNodes = getVisibleNodes();
    const visibleLinks = getVisibleLinks();

    simulation.nodes(visibleNodes);
    simulation.force('link').links(visibleLinks);

    link = linkLayer
      .selectAll('line')
      .data(visibleLinks, (d) => linkKey(d))
      .join(
        (enter) => enter.append('line').attr('class', 'link'),
        (update) => update,
        (exit) => exit.remove(),
      );

    linkHit = linkHitLayer
      .selectAll('line')
      .data(visibleLinks, (d) => linkKey(d))
      .join(
        (enter) => enter.append('line').attr('class', 'link-hit'),
        (update) => update,
        (exit) => exit.remove(),
      );

    node = nodeLayer
      .selectAll('foreignObject')
      .data(visibleNodes, (d) => d.id)
      .join(
        (enter) => enter.append('foreignObject').call(dragBehavior),
        (update) => update,
        (exit) => exit.remove(),
      );

    nodeDiv = node
      .selectAll('div')
      .data((d) => [d])
      .join(
        (enter) =>
          enter
            .append('xhtml:div')
            // New nodes start hidden (media-pending) so they are never visible
            // as a square placeholder. measureNodes promotes them to media-ready
            // once the <img> has decoded and the real aspect ratio is known.
            .attr(
              'class',
              (d) =>
                `node ${d.type}${d.type === 'work' ? ' media-pending' : ''}${toolLinks[d.name] ? ' has-tool-link' : ''}`,
            )
            .html((d) =>
              d.type === 'work'
                ? `<img class="node-img" src="${d.media_path}" alt="${d.name}">`
                : `<span class="node-text">${d.name.split(' ').join('<br>')}</span>`,
            ),
        // Existing nodes: preserve the media-pending/media-ready class that
        // measureNodes already set — only refresh non-media parts of the class.
        // Do NOT re-set .html() here: that would destroy and recreate the <img>,
        // losing its decoded state and forcing it back to media-pending.
        (update) =>
          update.attr('class', function (d) {
            const toolClass = toolLinks[d.name] ? ' has-tool-link' : '';
            if (d.type !== 'work') return `node ${d.type}${toolClass}`;
            const mediaClass = this.classList.contains('media-ready')
              ? 'media-ready'
              : 'media-pending';
            return `node ${d.type} ${mediaClass}${toolClass}`;
          }),
      );

    node.sort((a, b) => (b.type === 'work') - (a.type === 'work'));
    paintSelectedNode();
    paintSelectedLink();
    bindEditHandlers();
  }

  function measureNodes({
    enableCollision = true,
    collisionPadding = 10,
    collisionStrength = 1,
    collisionIterations = 1,
  } = {}) {
    const workStyle = getWorkStyleConfig();

    function measureRenderedContent(el) {
      // Use layout-box properties only (not getBoundingClientRect) because
      // getBoundingClientRect returns screen pixels which are scaled by the
      // SVG zoom transform, inflating the measured size and mis-centering nodes.
      const width = Math.max(el.offsetWidth || 0, el.clientWidth || 0, el.scrollWidth || 0);
      const height = Math.max(el.offsetHeight || 0, el.clientHeight || 0, el.scrollHeight || 0);

      return {
        w: Math.ceil(width),
        h: Math.ceil(height),
      };
    }

    node.each(function (d) {
      const div = d3.select(this).select('div').node();
      if (!div) return;

      let w = 0;
      let h = 0;

      if (d.type === 'work') {
        if (!d.media_path || !String(d.media_path).trim()) {
          w = 1;
          h = 1;
          d.w = w;
          d.h = h;
          d3.select(this).attr('width', w).attr('height', h);
          return;
        }

        const img = div.querySelector('img');
        if (img?.naturalWidth > 0 && img?.naturalHeight > 0) {
          const size = fitWorkImageSize(img, workStyle);
          img.style.width = `${size.imgW}px`;
          img.style.height = `${size.imgH}px`;
          w = size.w;
          h = size.h;
          // The image is decoded and correctly sized — safe to reveal.
          div.classList.remove('media-pending');
          div.classList.add('media-ready');
        } else {
          const side = Math.ceil(Math.sqrt(workStyle.targetArea));
          if (img) {
            img.style.width = `${side}px`;
            img.style.height = `${side}px`;
          }
          w = Math.max(d.w || 0, side + workStyle.padTotal);
          h = Math.max(d.h || 0, side + workStyle.padTotal);
          // Keep the square placeholder hidden until the real size is known.
          div.classList.add('media-pending');
          div.classList.remove('media-ready');
        }
      } else {
        const size = measureRenderedContent(div);
        w = size.w;
        h = size.h;
      }

      d.w = w;
      d.h = h;
      d3.select(this).attr('width', w).attr('height', h);
    });

    if (!enableCollision) {
      simulation.force('collision', null);
      return;
    }

    const nodePadding = collisionPadding;
    simulation.force(
      'collision',
      d3
        .forceCollide()
        .radius((d) => Math.max(d.w || 0, d.h || 0) / 2 + nodePadding)
        .strength(collisionStrength)
        .iterations(collisionIterations),
    );
  }

  // Attach load listeners on the given divs so each image promotes itself to
  // media-ready (and triggers measureNodes) as soon as it decodes — without
  // waiting for the next explicit renderGraph/measureNodes call.
  function finalizeWorkDivs(divs, collisionOptions = {}) {
    divs.forEach((div) => {
      const img = div.querySelector('img');
      if (!img) return;

      let recovered = false;
      const recover = () => {
        if (recovered) return;
        if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;

        recovered = true;
        div.classList.remove('media-pending');
        div.classList.add('media-ready');
        measureNodes({ enableCollision: true, ...collisionOptions });
        simulation.alpha(0.12).restart();
      };

      img.addEventListener('load', recover, { once: true });
      if (img.naturalWidth > 0 && img.naturalHeight > 0) recover();
    });
  }

  // Expose for onboarding: wire up load listeners on all currently-pending
  // work nodes so they reveal themselves as soon as their image decodes.
  // Pass collisionOptions to avoid disrupting the gentle onboarding simulation.
  function finalizePendingImages(collisionOptions = {}) {
    if (!nodeDiv) return;
    const pendingDivs = nodeDiv
      .filter((d) => d.type === 'work')
      .nodes()
      .filter((el) => el.classList.contains('media-pending'));
    finalizeWorkDivs(pendingDivs, collisionOptions);
  }

  async function waitForImages({ staggerMs = 0 } = {}) {
    const isSafari = document.body.classList.contains('is-safari');

    // Keep collisions disabled while nodes are still being sized/revealed,
    // so link forces can untangle the graph first.
    measureNodes({ enableCollision: false });

    const workDivs = nodeDiv.filter((d) => d.type === 'work').nodes();
    if (!workDivs.length) {
      measureNodes({ enableCollision: true });
      await new Promise((res) => requestAnimationFrame(() => res()));
      return;
    }

    if (isSafari) {
      const jobs = workDivs.map(async (div) => {
        const img = div.querySelector('img');
        await waitForImageReady(img, { timeoutMs: 3000 });
      });

      await Promise.allSettled(jobs);

      workDivs.forEach((div) => {
        const img = div.querySelector('img');
        if (img?.naturalWidth > 0 && img?.naturalHeight > 0) {
          div.classList.remove('media-pending');
          div.classList.add('media-ready');
        }
      });

      finalizeWorkDivs(workDivs);

      measureNodes({ enableCollision: true });
      simulation.alpha(0.12).restart();
      await new Promise((res) => requestAnimationFrame(() => res()));
      return;
    }

    const jobs = workDivs.map(async (div) => {
      const img = div.querySelector('img');
      await waitForImageReady(img, { timeoutMs: 3000 });
    });

    await Promise.allSettled(jobs);

    workDivs.forEach((div) => {
      const img = div.querySelector('img');
      if (img?.naturalWidth > 0 && img?.naturalHeight > 0) {
        div.classList.remove('media-pending');
        div.classList.add('media-ready');
      }
    });

    finalizeWorkDivs(workDivs);

    measureNodes({ enableCollision: true });
    await new Promise((res) => requestAnimationFrame(() => res()));
  }

  function getSelections() {
    return { link, linkHit, node };
  }

  return {
    setVisibility,
    setPreloadedMedia,
    renderGraph,
    paintSelectedNode,
    paintSelectedLink,
    measureNodes,
    finalizePendingImages,
    waitForImages,
    getSelections,
  };
}

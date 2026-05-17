(() => {
  let scheduled = false;
  let pageObserver = null;
  let pageObserverStarted = false;

  function resolveCssLengthPx(value, fallback) {
    const body = document.body;
    if (!body) return fallback;

    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.height = value;
    probe.style.width = '0';
    probe.style.overflow = 'hidden';
    body.appendChild(probe);

    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return Number.isFinite(height) && height > 0 ? height : fallback;
  }

  function resolveBaselinePx() {
    return resolveCssLengthPx('var(--baseline)', 0);
  }

  function scheduleSnap() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scheduled = false;
        snapFiguresToBaseline();
      });
    });
  }

  function startPageObserver() {
    if (pageObserverStarted) return;

    const root = document.body;
    if (!root) return;

    // Observe only child-list changes so our own style writes don't retrigger.
    pageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;

        let shouldSnap = false;

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches?.('.pagedjs_page, .pagedjs_pages') ||
            node.querySelector?.('.pagedjs_page')
          ) {
            shouldSnap = true;
            break;
          }
        }

        if (!shouldSnap) {
          for (const node of mutation.removedNodes) {
            if (!(node instanceof Element)) continue;
            if (
              node.matches?.('.pagedjs_page, .pagedjs_pages') ||
              node.querySelector?.('.pagedjs_page')
            ) {
              shouldSnap = true;
              break;
            }
          }
        }

        if (shouldSnap) {
          scheduleSnap();
          return;
        }
      }
    });

    pageObserver.observe(root, { childList: true, subtree: true });
    pageObserverStarted = true;
  }

  function snapFiguresToBaseline() {
    const baseline = resolveBaselinePx();
    const pages = document.querySelectorAll('.pagedjs_page');
    if (!pages.length) return;
    if (!baseline) return;

    pages.forEach((page) => {
      const blocks = page.querySelectorAll('figure, .code-block');
      if (!blocks.length) return;

      blocks.forEach((block) => {
        if (block.tagName === 'FIGURE') {
          const imgs = block.querySelectorAll('img');
          for (const img of imgs) {
            if (img.complete) continue;
            img.addEventListener('load', scheduleSnap, { once: true });
            img.addEventListener('error', scheduleSnap, { once: true });
            return;
          }
        }

        // We want:
        // 1) margin-bottom >= baseline
        // 2) (blockHeight + margin-bottom) is a multiple of baseline
        const blockHeight = block.getBoundingClientRect().height;
        const total = baseline * Math.ceil((blockHeight + baseline) / baseline);
        const pad = total - blockHeight;
        const nextMarginBottom = `${pad.toFixed(3)}px`;
        if (block.style.marginBottom !== nextMarginBottom) {
          block.style.marginBottom = nextMarginBottom;
        }
      });
    });
  }

  // Boot: run on initial load and on explicit Paged.js render lifecycle events.
  startPageObserver();
  scheduleSnap();
  document.addEventListener('DOMContentLoaded', () => {
    startPageObserver();
    scheduleSnap();
  });
  window.addEventListener('load', () => {
    startPageObserver();
    scheduleSnap();
  });
  window.addEventListener('resize', () => {
    scheduleSnap();
  });
  document.addEventListener('pagedjs:rendered', () => {
    scheduleSnap();
  });
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      scheduleSnap();
    });
  }
})();

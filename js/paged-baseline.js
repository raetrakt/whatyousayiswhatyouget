(() => {
  let scheduled = false;
  let pagesObserver = null;
  let rootObserver = null;

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

  function snapFiguresToBaseline() {
    const baseline = resolveBaselinePx();
    const pages = document.querySelectorAll('.pagedjs_page');
    if (!pages.length) return;
    if (!baseline) return;

    pages.forEach((page) => {
      const figures = page.querySelectorAll('figure');
      if (!figures.length) return;

      figures.forEach((figure) => {
        const imgs = figure.querySelectorAll('img');
        for (const img of imgs) {
          if (img.complete) continue;
          img.addEventListener('load', scheduleSnap, { once: true });
          img.addEventListener('error', scheduleSnap, { once: true });
          return;
        }

        // We want:
        // 1) margin-bottom >= baseline
        // 2) (figureHeight + margin-bottom) is a multiple of baseline
        const figureHeight = figure.getBoundingClientRect().height;
        const total = baseline * Math.ceil((figureHeight + baseline) / baseline);
        const pad = total - figureHeight;
        figure.style.marginBottom = `${pad.toFixed(3)}px`;
      });
    });
  }

  function ensurePagedObservers() {
    const pagesRoot = document.querySelector('.pagedjs_pages');
    if (pagesRoot && !pagesObserver) {
      pagesObserver = new MutationObserver(scheduleSnap);
      pagesObserver.observe(pagesRoot, { childList: true, subtree: true });
      scheduleSnap();
    }

    if (!rootObserver) {
      rootObserver = new MutationObserver(() => {
        const nextRoot = document.querySelector('.pagedjs_pages');
        if (!nextRoot) return;

        if (pagesObserver) pagesObserver.disconnect();
        pagesObserver = new MutationObserver(scheduleSnap);
        pagesObserver.observe(nextRoot, { childList: true, subtree: true });
        scheduleSnap();
      });

      rootObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Boot: run immediately, then keep up with Paged.js reflows/rebuilds.
  ensurePagedObservers();
  scheduleSnap();
  document.addEventListener('DOMContentLoaded', () => {
    ensurePagedObservers();
    scheduleSnap();
  });
  window.addEventListener('load', () => {
    ensurePagedObservers();
    scheduleSnap();
  });
  document.addEventListener('pagedjs:rendered', () => {
    ensurePagedObservers();
    scheduleSnap();
  });
})();

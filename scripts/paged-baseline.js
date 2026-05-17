(() => {
  let scheduled = false;

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
  scheduleSnap();
  document.addEventListener('DOMContentLoaded', () => {
    scheduleSnap();
  });
  window.addEventListener('load', () => {
    scheduleSnap();
  });
  document.addEventListener('pagedjs:rendered', () => {
    scheduleSnap();
  });
})();

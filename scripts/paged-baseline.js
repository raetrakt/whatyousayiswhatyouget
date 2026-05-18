(() => {
  const TARGET_SELECTOR = 'figure, .code-block';
  const SNAP_ATTR = 'data-baseline-snap-id';
  const CACHE_KEY_BASE = 'paged-baseline-cache-v1';
  const CACHE_META_KEY = 'paged-baseline-meta-v1';
  const DEBUG = true;
  let snapCounter = 0;
  let hookInstalled = false;

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

  function resolveNumberVar(varName, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function getLayoutSignature() {
    const baseline = resolveBaselinePx();
    const pageWidth = resolveCssLengthPx('var(--page-width)', 0);
    const pageHeight = resolveCssLengthPx('var(--page-height)', 0);
    const marginTop = resolveCssLengthPx('var(--page-margin-top)', 0);
    const marginRight = resolveCssLengthPx('var(--page-margin-right)', 0);
    const marginBottom = resolveCssLengthPx('var(--page-margin-bottom)', 0);
    const marginLeft = resolveCssLengthPx('var(--page-margin-left)', 0);
    const columnCount = resolveNumberVar('--column-count', 1);
    const columnGap = resolveCssLengthPx('var(--column-gap)', 0);

    return [
      baseline.toFixed(3),
      pageWidth.toFixed(3),
      pageHeight.toFixed(3),
      marginTop.toFixed(3),
      marginRight.toFixed(3),
      marginBottom.toFixed(3),
      marginLeft.toFixed(3),
      columnCount.toFixed(3),
      columnGap.toFixed(3),
    ].join('|');
  }

  function getCacheKey(signature) {
    return `${CACHE_KEY_BASE}:${signature}`;
  }

  function getStableIdForTarget(target) {
    if (target.id) return `id:${target.id}`;
    const img = target.querySelector?.('img');
    if (img && img.getAttribute('src')) return `img:${img.getAttribute('src')}`;
    snapCounter += 1;
    return `seq:${snapCounter}`;
  }

  function ensureSnapIds(targets) {
    targets.forEach((target) => {
      if (target.hasAttribute(SNAP_ATTR)) return;
      const stableId = getStableIdForTarget(target);
      target.setAttribute(SNAP_ATTR, stableId);
    });
  }

  function loadCache(signature) {
    try {
      const raw = localStorage.getItem(getCacheKey(signature));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveCache(signature, payload) {
    try {
      localStorage.setItem(getCacheKey(signature), JSON.stringify(payload));
    } catch (error) {
      // Ignore quota or storage errors.
    }
  }

  function saveMeta(meta) {
    try {
      localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta));
    } catch (error) {
      // Ignore quota or storage errors.
    }
  }

  function readMeta() {
    try {
      const raw = localStorage.getItem(CACHE_META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function applyCachedMargins(targets, cache) {
    if (!cache) return false;
    let applied = 0;

    targets.forEach((target) => {
      const key = target.getAttribute(SNAP_ATTR);
      if (!key) return;
      const pad = cache[key];
      if (!Number.isFinite(pad)) return;
      target.style.marginBottom = `${pad.toFixed(3)}px`;
      applied += 1;
    });

    return applied > 0;
  }

  function waitForImages(root) {
    const images = Array.from(root.querySelectorAll('img'));
    if (!images.length) return Promise.resolve();

    return Promise.all(
      images.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          }),
      ),
    );
  }

  function scheduleCacheWrite() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        writeCacheFromRenderedPages();
      });
    });
  }

  function writeCacheFromRenderedPages() {
    const signature = getLayoutSignature();
    const baseline = resolveBaselinePx();
    const pages = document.querySelectorAll('.pagedjs_page');
    if (!pages.length || !baseline) return;

    const targets = Array.from(document.querySelectorAll(TARGET_SELECTOR));
    ensureSnapIds(targets);

    const cache = {};

    targets.forEach((target) => {
      const key = target.getAttribute(SNAP_ATTR);
      if (!key) return;
      const blockHeight = target.getBoundingClientRect().height;
      const total = baseline * Math.ceil((blockHeight + baseline) / baseline);
      const pad = total - blockHeight;
      cache[key] = pad;
    });

    saveCache(signature, cache);
    saveMeta({
      signature,
      baseline,
      updatedAt: Date.now(),
      targetCount: targets.length,
      pageCount: pages.length,
    });

    if (DEBUG) {
      console.info('[baseline-cache] saved', {
        signature,
        baseline,
        targets: targets.length,
        pages: pages.length,
      });
    }
  }

  function startRenderedObserver() {
    const root = document.body;
    if (!root) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches?.('.pagedjs_page, .pagedjs_pages') ||
            node.querySelector?.('.pagedjs_page')
          ) {
            scheduleCacheWrite();
            return;
          }
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
  }

  async function applyCachedMarginsBeforePaged() {
    const targets = Array.from(document.querySelectorAll(TARGET_SELECTOR));
    if (!targets.length) return;

    ensureSnapIds(targets);
    const signature = getLayoutSignature();
    const meta = readMeta();
    if (!meta || meta.signature !== signature) {
      if (DEBUG) {
        console.info('[baseline-cache] signature mismatch, skipping pre-apply', {
          signature,
          meta,
        });
      }
      return;
    }

    const cache = loadCache(signature);
    if (!cache) {
      if (DEBUG) {
        console.info('[baseline-cache] no cache found, skipping pre-apply');
      }
      return;
    }

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await waitForImages(document);

    const applied = applyCachedMargins(targets, cache);
    if (DEBUG) {
      console.info('[baseline-cache] pre-apply', {
        applied,
        targets: targets.length,
        meta,
      });
    }
  }

  function installPagedHook() {
    if (hookInstalled) return;

    const config = window.PagedConfig || {};
    const previousBefore = config.before;
    window.PagedConfig = config;
    window.PagedConfig.before = async () => {
      if (typeof previousBefore === 'function') {
        await previousBefore();
      }
      await applyCachedMarginsBeforePaged();
    };

    hookInstalled = true;
  }

  installPagedHook();
  document.addEventListener('DOMContentLoaded', () => {
    startRenderedObserver();
    scheduleCacheWrite();
  });
  window.addEventListener('load', () => {
    scheduleCacheWrite();
  });
  document.addEventListener('pagedjs:rendered', scheduleCacheWrite);
})();

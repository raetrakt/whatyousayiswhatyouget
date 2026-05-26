(() => {
  if (!window.MechanicalRaggerCore) return;

  // Read CSS vars NOW — synchronously at script-load time, while the original
  // stylesheets are still applied. Paged.js removes/replaces stylesheets before
  // calling PagedConfig.before(), so getComputedStyle() returns empty strings there.
  const _rootStyles = getComputedStyle(document.documentElement);
  const _rawVars = {
    pageWidth: _rootStyles.getPropertyValue('--page-width').trim(),
    marginLeft: _rootStyles.getPropertyValue('--page-margin-left').trim(),
    marginRight: _rootStyles.getPropertyValue('--page-margin-right').trim(),
    columnGap: _rootStyles.getPropertyValue('--column-gap').trim(),
    columnCount: _rootStyles.getPropertyValue('--column-count').trim(),
  };

  const instances = new WeakMap();
  const exclusionClass = 'mechanical-ragger-exclusion';
  const textRootClass = 'mechanical-ragger-text';

  function ensureTextRoot(element) {
    const existingTextRoot = element.querySelector(`:scope > .${textRootClass}`);
    if (existingTextRoot) return existingTextRoot;

    const textRoot = document.createElement('span');
    textRoot.className = textRootClass;
    // Do NOT set display:block — keeping this inline lets Paged.js break
    // the paragraph across columns. A block span would make the whole
    // paragraph an unbreakable unit, causing overset on long paragraphs.

    const nodesToMove = [];
    element.childNodes.forEach((node) => {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.classList &&
        node.classList.contains(exclusionClass)
      ) {
        return;
      }
      nodesToMove.push(node);
    });

    nodesToMove.forEach((node) => textRoot.appendChild(node));
    element.appendChild(textRoot);
    return textRoot;
  }

  function ensureExclusion(element, textRoot) {
    const existingExclusion = element.querySelector(`:scope > .${exclusionClass}`);
    if (existingExclusion) return existingExclusion;

    const exclusion = document.createElement('div');
    exclusion.className = exclusionClass;
    exclusion.setAttribute('aria-hidden', 'true');
    element.insertBefore(exclusion, textRoot);
    return exclusion;
  }

  // Parse a CSS length string ('210mm', '8mm', '96px', etc.) to px without
  // needing a DOM probe element, so this works even before Paged runs.
  function parseLengthToPx(str) {
    if (!str) return 0;
    str = str.trim();
    const mm = str.match(/^([\d.]+)\s*mm$/);
    if (mm) return (parseFloat(mm[1]) * 96) / 25.4;
    const px = str.match(/^([\d.]+)\s*px$/);
    if (px) return parseFloat(px[1]);
    const pt = str.match(/^([\d.]+)\s*pt$/);
    if (pt) return (parseFloat(pt[1]) * 96) / 72;
    const rem = str.match(/^([\d.]+)\s*rem$/);
    if (rem)
      return parseFloat(rem[1]) * parseFloat(getComputedStyle(document.documentElement).fontSize);
    return 0;
  }

  function resolveColumnWidthPx() {
    const pageWidth = parseLengthToPx(_rawVars.pageWidth);
    const marginLeft = parseLengthToPx(_rawVars.marginLeft);
    const marginRight = parseLengthToPx(_rawVars.marginRight);
    const columnGap = parseLengthToPx(_rawVars.columnGap);
    const columnCount = parseFloat(_rawVars.columnCount) || 2;

    console.info('[ragger] raw vars', _rawVars);
    console.info('[ragger] resolved px', {
      pageWidth,
      marginLeft,
      marginRight,
      columnGap,
      columnCount,
    });

    if (!pageWidth) return 0;
    return (pageWidth - marginLeft - marginRight - columnGap * (columnCount - 1)) / columnCount;
  }

  function applyToElementWithBounds(element, bounds) {
    if (element.classList && element.classList.contains('code')) return;

    const textRoot = ensureTextRoot(element);

    // Only modify innerHTML once to avoid double-replacing on re-apply.
    if (!element.hasAttribute('data-ragger-init')) {
      if (window.preventShortSentenceStartBreaks) window.preventShortSentenceStartBreaks(textRoot);
      element.setAttribute('data-ragger-init', '1');
    }

    const measuredBounds = bounds || textRoot.getBoundingClientRect();

    if (instances.has(element)) {
      const ragger = instances.get(element);
      if (measuredBounds.width > 0 && measuredBounds.height > 0) {
        ragger.containerBounds = measuredBounds;
      }
      ragger.update();
      return;
    }

    const exclusion = ensureExclusion(element, textRoot);

    const ragger = new window.MechanicalRaggerCore({
      container: textRoot,
      onUpdate: (styles) => {
        Object.assign(exclusion.style, styles);
      },
    });

    instances.set(element, ragger);

    // Inject bounds synchronously so update() has a non-zero blockSize.
    // getBoundingClientRect() forces layout, giving us the actual dimensions.
    if (measuredBounds.width > 0 && measuredBounds.height > 0) {
      ragger.containerBounds = measuredBounds;
    }
    ragger.update();
  }

  function applyInRoot(root, selector) {
    root.querySelectorAll(selector).forEach(applyToElement);
  }

  // Apply ragger to source DOM paragraphs inside an offscreen column-width
  // container so floats are computed at the correct print width before Paged
  // paginates. This avoids post-render height changes that cause overset.
  async function applyMechanicalRaggingPrePaged(
    selector = '.mechanical-ragger-target p:not(.code)',
  ) {
    const columnWidth = resolveColumnWidthPx();
    console.info('[ragger] columnWidth', columnWidth);
    if (!columnWidth) {
      console.warn('[ragger] columnWidth resolved to 0, aborting');
      return;
    }

    if (document.fonts?.ready) await document.fonts.ready;

    const targets = Array.from(document.querySelectorAll(selector));
    console.info('[ragger] targets found', targets.length, selector);
    if (!targets.length) return;

    // Build an offscreen column-width container, move targets in, run ragger,
    // then move targets back.
    const offscreen = document.createElement('div');
    offscreen.setAttribute('aria-hidden', 'true');
    offscreen.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      `width:${columnWidth}px`,
      'visibility:hidden',
      'pointer-events:none',
      'display:block',
    ].join(';');
    document.body.appendChild(offscreen);

    // Placeholder comments to preserve source DOM positions.
    const placeholders = targets.map((el) => {
      const ph = document.createComment('ragger-placeholder');
      el.parentNode.insertBefore(ph, el);
      offscreen.appendChild(el);
      return { el, ph };
    });

    // Apply ragger to all targets while in the offscreen container.
    // getBoundingClientRect() forces synchronous layout and injects bounds
    // directly so update() has a non-zero blockSize without waiting for ResizeObserver.
    let applied = 0;
    targets.forEach((el) => {
      // ensureTextRoot may not have run yet; call applyToElementWithBounds first
      // with null so it wraps content, then re-measure the textRoot.
      applyToElementWithBounds(el, null);
      const textRoot = el.querySelector(`.${textRootClass}`) || el;
      const bounds = textRoot.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        const ragger = instances.get(el);
        if (ragger) {
          ragger.containerBounds = bounds;
          ragger.lastCssSignature = ''; // force re-emit
          ragger.update();
          applied += 1;
        }
      }
    });

    console.info('[ragger] applied to', applied, 'of', targets.length, 'targets');

    // Restore targets to their original positions.
    placeholders.forEach(({ el, ph }) => {
      ph.parentNode.insertBefore(el, ph);
      ph.remove();
    });

    offscreen.remove();
  }

  window.applyMechanicalRagging = applyMechanicalRaggingPrePaged;

  // Hook into PagedConfig.before so ragger runs before pagination.
  const existingConfig = window.PagedConfig || {};
  const previousBefore = existingConfig.before;
  window.PagedConfig = existingConfig;
  window.PagedConfig.before = async () => {
    if (typeof previousBefore === 'function') await previousBefore();
    await applyMechanicalRaggingPrePaged();
  };
})();

(() => {
  if (!window.MechanicalRaggerCore) return;

  const instances = new WeakMap();
  const sentenceStarts = /(^|[.!?]\s+)([a-zA-Z]{1,3})\s+/g;
  const exclusionClass = 'mechanical-ragger-exclusion';
  const textRootClass = 'mechanical-ragger-text';

  function preventShortSentenceStartBreaks(element) {
    element.innerHTML = element.innerHTML.replace(sentenceStarts, (match, p1, p2) => {
      return `${p1}${p2}&nbsp;`;
    });
  }

  function ensureTextRoot(element) {
    const existingTextRoot = element.querySelector(`:scope > .${textRootClass}`);
    if (existingTextRoot) return existingTextRoot;

    const textRoot = document.createElement('span');
    textRoot.className = textRootClass;
    textRoot.style.display = 'block';

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

  function applyToElement(element) {
    if (element.classList && element.classList.contains('code')) return;

    // Keep the float outside the text root to avoid feedback loops in measurement.
    const textRoot = ensureTextRoot(element);
    preventShortSentenceStartBreaks(textRoot);

    if (instances.has(element)) {
      instances.get(element).update();
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
    ragger.update();
  }

  function applyInRoot(root, selector) {
    root.querySelectorAll(selector).forEach(applyToElement);
  }

  function applyMechanicalRagging(selector = '.mechanical-ragger-target p:not(.code)') {
    const pagesRoot = document.querySelector('.pagedjs_pages');
    if (pagesRoot) {
      applyInRoot(pagesRoot, selector);
      return;
    }

    applyInRoot(document, selector);
  }

  function scheduleApply() {
    requestAnimationFrame(() => applyMechanicalRagging());
  }

  window.applyMechanicalRagging = applyMechanicalRagging;

  if (window.Paged && window.Paged.Handler && window.Paged.registerHandlers) {
    class MechanicalRaggerHandler extends window.Paged.Handler {
      afterRendered() {
        applyMechanicalRagging();
      }
    }

    window.Paged.registerHandlers(MechanicalRaggerHandler);
  }

  document.addEventListener('DOMContentLoaded', scheduleApply);
  window.addEventListener('load', scheduleApply);
  document.addEventListener('pagedjs:rendered', scheduleApply);
})();

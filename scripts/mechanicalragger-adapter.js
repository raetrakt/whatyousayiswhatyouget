(() => {
  if (!window.MechanicalRaggerCore) return;

  const instances = new WeakMap();
  const sentenceStarts = /(^|[.!?]\s+)([a-zA-Z]{1,3})\s+/g;

  function preventShortSentenceStartBreaks(element) {
    element.innerHTML = element.innerHTML.replace(sentenceStarts, (match, p1, p2) => {
      return `${p1}${p2}&nbsp;`;
    });
  }

  function applyToElement(element) {
    if (element.classList && element.classList.contains('code')) return;
    if (instances.has(element)) {
      instances.get(element).update();
      return;
    }

    preventShortSentenceStartBreaks(element);

    const exclusion = document.createElement('div');
    exclusion.className = 'mechanical-ragger-exclusion';
    exclusion.setAttribute('aria-hidden', 'true');
    element.insertBefore(exclusion, element.firstChild);

    const ragger = new window.MechanicalRaggerCore({
      container: element,
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

(() => {
  const sentenceStarts = /(^|[.!?]\s+)([a-zA-Z]{1,3})\s+/g;

  function preventShortSentenceStartBreaks(element) {
    element.innerHTML = element.innerHTML.replace(sentenceStarts, (match, p1, p2) => {
      return `${p1}${p2}&nbsp;`;
    });
  }

  function run() {
    document
      .querySelectorAll('.thesis-layout p:not(.code), .about-text p:not(.code)')
      .forEach(preventShortSentenceStartBreaks);
  }

  window.preventShortSentenceStartBreaks = preventShortSentenceStartBreaks;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

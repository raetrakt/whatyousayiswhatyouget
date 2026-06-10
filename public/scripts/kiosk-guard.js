(function () {
  document.addEventListener(
    'click',
    function (e) {
      var anchor = e.target.closest('a');
      if (!anchor) return;
      var href = anchor.getAttribute('href');
      if (!href) return;
      // Block absolute URLs pointing to a different origin
      try {
        var url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) {
          e.preventDefault();
          e.stopPropagation();
        }
      } catch (_) {
        // Unparseable href — let it through
      }
    },
    true,
  );

  // ── Idle reset ────────────────────────────────────────────────────────────
  // After 4 minutes of no mouse/touch/keyboard activity, return to root.
  var IDLE_MS = 4 * 60 * 1000;
  var ROOT = '/dictionary/';
  var idleTimer;

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      window.location.href = ROOT;
    }, IDLE_MS);
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach(function (evt) {
    document.addEventListener(evt, resetIdle, { passive: true, capture: true });
  });

  resetIdle(); // start the timer on page load
})();

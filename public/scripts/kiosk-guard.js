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
})();

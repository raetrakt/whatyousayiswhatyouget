(function () {
  const header = document.createElement('header');
  header.className = 'site-header hide-in-print';
  header.innerHTML = `
    <a href="/">What You Say Is What You Get?</a>
    <nav class="site-header-nav">
      <a href="/">Dictionary</a>
      <a href="/tools/">Tools</a>
      <a href="/manifesto/">Manifesto</a>
      <a href="/thesis/">Thesis</a>
    </nav>
  `;
  document.body.insertBefore(header, document.body.firstChild);

  const headerHeight = parseFloat(getComputedStyle(header).height) || 0;
  const existingPaddingTop = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  if (!document.body.hasAttribute('data-no-header-padding')) {
    document.body.style.paddingTop = existingPaddingTop + headerHeight + 'px';
  }
})();

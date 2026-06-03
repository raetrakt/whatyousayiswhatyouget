(function () {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a href="/" data-label="What You Say Is What You Get?"><span>What You Say Is What You Get?</span></a>
    <nav class="site-header-nav">
      <a href="/" data-label="Dictionary"><span>Dictionary</span></a>
      <a href="/tools/" data-label="Tools"><span>Tools</span></a>
      <a href="/manifesto/" data-label="Manifesto"><span>Manifesto</span></a>
      <a href="/thesis/" data-label="Thesis"><span>Thesis</span></a>
    </nav>
  `;
  document.body.insertBefore(header, document.body.firstChild);

  const headerHeight = parseFloat(getComputedStyle(header).height) || 0;
  const existingPaddingTop = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  if (!document.body.hasAttribute('data-no-header-padding')) {
    document.body.style.paddingTop = existingPaddingTop + headerHeight + 'px';
  }
})();

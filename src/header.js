(function () {
  const header = document.createElement('header');
  header.className = 'site-header';
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

  const DELAY = 30; // ms per character

  for (const link of header.querySelectorAll('a')) {
    const text = link.textContent;
    // Lock width to normal-font size before splitting chars
    link.style.width = link.getBoundingClientRect().width + 'px';
    link.innerHTML = text
      .split('')
      .map((ch) => `<span class="hc">${ch === ' ' ? '\u00a0' : ch}</span>`)
      .join('');

    let timers = [];

    link.addEventListener('mouseenter', () => {
      timers.forEach(clearTimeout);
      timers = [];
      const chars = link.querySelectorAll('.hc');
      chars.forEach((ch, i) => {
        timers.push(setTimeout(() => ch.classList.add('hc-on'), i * DELAY));
      });
    });

    link.addEventListener('mouseleave', () => {
      timers.forEach(clearTimeout);
      timers = [];
      const chars = link.querySelectorAll('.hc');
      chars.forEach((ch, i) => {
        timers.push(setTimeout(() => ch.classList.remove('hc-on'), i * DELAY));
      });
    });
  }

  const headerHeight = parseFloat(getComputedStyle(header).height) || 0;
  const existingPaddingTop = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  if (!document.body.hasAttribute('data-no-header-padding')) {
    document.body.style.paddingTop = existingPaddingTop + headerHeight + 'px';
  }
})();

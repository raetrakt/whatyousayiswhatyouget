(function () {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a href="/" data-hover-name="GET /index.html&#10;HTTP/2.0"><span class="header-text">What You Say Is What You Get?</span></a>
    <nav class="site-header-nav">
      <a href="/dictionary/" data-hover-name="GET /dictionary/&#10;HTTP/2.0"><span class="header-text">Dictionary</span></a>
      <a href="/tools/" data-hover-name="GET /tools/&#10;HTTP/2.0"><span class="header-text">Tools</span></a>
      <a href="/manifesto/" data-hover-name="GET /manifesto/&#10;HTTP/2.0"><span class="header-text">Manifesto</span></a>
      <a href="/thesis/" data-hover-name="GET /thesis/&#10;HTTP/2.0"><span class="header-text">Thesis</span></a>
    </nav>
  `;
  document.body.insertBefore(header, document.body.firstChild);

  const headerHeight = parseFloat(getComputedStyle(header).height) || 0;
  const existingPaddingTop = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  if (!document.body.hasAttribute('data-no-header-padding')) {
    document.body.style.paddingTop = headerHeight + 'px';
  }

  const DELAY = 18; // ms per character

  for (const link of header.querySelectorAll('.site-header a')) {
    const headerText = link.querySelector('.header-text');
    const hoverText = link.getAttribute('data-hover-name') || '';

    const hoverWrap = document.createElement('span');
    hoverWrap.className = 'header-hover-text';
    hoverWrap.style.opacity = '0';

    const chars = [];
    for (const ch of hoverText) {
      if (ch === '\n') {
        hoverWrap.appendChild(document.createElement('br'));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'header-hover-char';
      span.textContent = ch === ' ' ? '\u00a0' : ch;
      span.style.opacity = '0';
      hoverWrap.appendChild(span);
      chars.push(span);
    }

    link.appendChild(hoverWrap);
    link.removeAttribute('data-hover-name');

    let timers = [];

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    function activateHoverText() {
      clearTimers();
      if (headerText) {
        headerText.style.opacity = '0';
      }
      hoverWrap.style.opacity = '1';
      chars.forEach((span) => {
        span.style.opacity = '0';
      });
      chars.forEach((span, i) => {
        timers.push(
          setTimeout(() => {
            span.style.opacity = '1';
          }, i * DELAY),
        );
      });
    }

    function deactivateHoverText() {
      clearTimers();
      hoverWrap.style.opacity = '0';
      chars.forEach((span) => {
        span.style.opacity = '0';
      });
      if (headerText) {
        headerText.style.opacity = '1';
      }
    }

    link.addEventListener('mouseenter', activateHoverText);
    link.addEventListener('mouseleave', deactivateHoverText);
    link.addEventListener('focus', activateHoverText);
    link.addEventListener('blur', deactivateHoverText);
  }
})();

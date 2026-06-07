(function () {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a href="/" data-hover-name="GET whatyousayiswhatyouget.net&#10;HTTP/2.0"><span class="header-text"><span class="site-title-text"></span></span></a>
    <nav class="site-header-nav" id="site-header-nav">
      <button class="nav-menu-toggle" aria-expanded="false" aria-controls="site-header-nav">Menu</button>
      <a href="/dictionary/" data-hover-name="GET /dictionary/&#10;HTTP/2.0"><span class="header-text">Dictionary</span></a>
      <a href="/tools/" data-hover-name="GET /tools/&#10;HTTP/2.0"><span class="header-text">Tools</span></a>
      <a href="/manifesto/" data-hover-name="GET /manifesto/&#10;HTTP/2.0"><span class="header-text">Manifesto</span></a>
      <a href="/thesis/" data-hover-name="GET /thesis/&#10;HTTP/2.0"><span class="header-text">Thesis</span></a>
      <a href="/about/" data-hover-name="GET /about/&#10;HTTP/2.0"><span class="header-text">About</span></a>
    </nav>
  `;
  document.body.insertBefore(header, document.body.firstChild);

  const siteTitle = header.querySelector('.site-title-text');
  function updateSiteTitle() {
    if (siteTitle) {
      siteTitle.innerHTML = window.innerWidth < 1400
        ? 'WYS<span class="si-kerning"></span>IWYG?'
        : 'What You Say Is What You Get?';
    }
  }
  updateSiteTitle();
  window.addEventListener('resize', updateSiteTitle);

  const toggle = header.querySelector('.nav-menu-toggle');
  const nav = header.querySelector('.site-header-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.textContent = open ? 'Menu' : 'Close';
      nav.classList.toggle('nav-open', !open);
    });
  }

  const headerHeight = parseFloat(getComputedStyle(header).height) || 0;
  const existingPaddingTop = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  const workModal = document.getElementById('work-modal');
  if (!document.body.hasAttribute('data-no-header-padding')) {
    document.body.style.paddingTop = headerHeight + 'px';
  } else if (workModal) {
    const existingPaddingModal = parseFloat(getComputedStyle(workModal).paddingTop) || 0;
    workModal.style.paddingTop = existingPaddingModal + headerHeight + 'px';
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

    function activateHoverText(e) {
      // Ignore phantom mouseenter fired on first mouse activity after page
      // load (when the cursor was already over the link). Real entries always
      // have a relatedTarget (the element the cursor came from).
      if (e && !e.relatedTarget) return;
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
    link.addEventListener('blur', deactivateHoverText);
  }
})();

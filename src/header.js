(function () {
  const HEADER_HEIGHT = 40;

  const style = document.createElement('style');
  style.textContent = `
    .site-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: ${HEADER_HEIGHT}px;
      background: #fff;
      border-bottom: 1px solid #000;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 9999;
      box-sizing: border-box;
    }

    .site-header,
    .site-header * {
      font-family: 'Times New Roman', Times, serif;
      font-size: 24px;
      line-height: 1;
    }

    .site-header a {
      color: #000;
      text-decoration: none;
    }

    .site-header a:hover {
      
    }

    .site-header-nav {
      display: flex;
      gap: 24px;
    }
  `;
  document.head.appendChild(style);

  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a href="/">What You Say Is What You Get?</a>
    <nav class="site-header-nav">
      <a href="/">Dictionary</a>
      <a href="/tools/">Tools</a>
      <a href="/manifesto/">Killing the Vibe</a>
      <a href="/thesis/">Thesis</a>
    </nav>
  `;
  document.body.insertBefore(header, document.body.firstChild);

  const existingPaddingTop = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  document.body.style.paddingTop = (existingPaddingTop + HEADER_HEIGHT) + 'px';
})();

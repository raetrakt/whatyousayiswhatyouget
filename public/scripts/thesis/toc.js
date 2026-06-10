const disableNumbering = false;

const buildToc = () => {
  const contents = document.querySelector('.table-of-contents');
  if (!contents || contents.dataset.tocBuilt === 'true') return;

  // Add mobile toggle button if not already present
  if (!contents.querySelector('.toc-toggle')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'toc-toggle-wrapper';
    const toggle = document.createElement('button');
    toggle.className = 'toc-toggle';
    toggle.textContent = 'Contents';
    toggle.setAttribute('aria-expanded', 'false');
    wrapper.appendChild(toggle);
    contents.insertBefore(wrapper, contents.firstChild);
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.textContent = open ? 'Contents' : 'Close';
      contents.classList.toggle('toc-open', !open);
    });

    contents.addEventListener('click', (e) => {
      if (e.target.closest('a') && window.innerWidth < 1400) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = 'Contents';
        contents.classList.remove('toc-open');
      }
    });
  }

  const headings = Array.from(
    document.querySelectorAll(
      '.thesis-layout h1:not(.hide-in-toc, .hide-on-web), .thesis-layout h2, .thesis-layout h3, .thesis-layout h4, .thesis-layout h5, .thesis-layout h6',
    ),
  );
  const firstNumberedHeadingIndex = headings.findIndex(
    (heading) => heading.tagName === 'H1' && !heading.classList.contains('chapter'),
  );

  // Title
  // const title = document.createElement('h2');
  // title.textContent = 'Contents';
  // contents.appendChild(title);

  const addEntry = (heading, number, indentLevel) => {
    const p = document.createElement('p');
    const level = parseInt(heading.tagName.substring(1), 10);
    if (level == 3 || level === 4 || level === 5) p.classList.add('low-level-heading');
    const isMobile = window.innerWidth < 800;
    const indent = '\u00A0'.repeat(indentLevel * (isMobile ? 0 : 2));
    p.textContent = indent;

    const a = document.createElement('a');
    a.href = heading.id ? `#${heading.id}` : '#';
    a.textContent = number
      ? `${number} ${heading.textContent.trim()}`
      : `${heading.textContent.trim()}`;
    p.appendChild(a);
    contents.appendChild(p);
  };

  // Keep the opening items unnumbered.
  for (let index = 0; index < firstNumberedHeadingIndex; index++) {
    const heading = headings[index];
    addEntry(heading, '', 0);
  }

  const counters = [0, 0, 0, 0, 0, 0, 0];

  for (let index = firstNumberedHeadingIndex; index < headings.length; index++) {
    const heading = headings[index];
    const level = parseInt(heading.tagName.substring(1), 10);

    counters[level]++;
    for (let deeper = level + 1; deeper <= 6; deeper++) {
      counters[deeper] = 0;
    }

    const parts = [];
    for (let currentLevel = 1; currentLevel <= level; currentLevel++) {
      if (counters[currentLevel] === 0) {
        continue;
      }
      parts.push(counters[currentLevel]);
    }

    const num = disableNumbering ? '' : parts.join('.');
    addEntry(heading, num, Math.max(0, level - 1));
  }

  contents.dataset.tocBuilt = 'true';
};

const setupTocHighlight = () => {
  const contents = document.querySelector('.table-of-contents');
  if (!contents) return;

  const headings = Array.from(
    document.querySelectorAll(
      '.thesis-layout h1:not(.hide-in-toc, .hide-on-web), .thesis-layout h2, .thesis-layout h3, .thesis-layout h4, .thesis-layout h5, .thesis-layout h6',
    ),
  );

  const getActiveHeading = () => {
    let active = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= 150) {
        active = heading;
      } else {
        break;
      }
    }
    return active;
  };

  const updateActive = () => {
    const active = getActiveHeading();
    contents.querySelectorAll('a').forEach((a) => a.classList.remove('active'));
    if (active) {
      const link = contents.querySelector(`a[href="#${active.id}"]`);
      if (link) link.classList.add('active');
    }
  };

  window.addEventListener('scroll', updateActive, { passive: true });
  updateActive();
};

buildToc();
setupTocHighlight();
document.addEventListener('DOMContentLoaded', () => {
  buildToc();
  setupTocHighlight();
});
document.addEventListener('afterprint', buildToc);
if (window.Paged) {
  document.addEventListener('pagedjs:rendered', buildToc);
}

const buildToc = () => {
  const contents = document.querySelector('.table-of-contents');
  if (!contents || contents.dataset.tocBuilt === 'true') return;

  const headings = Array.from(
    document.querySelectorAll(
      '.thesis-layout h1, .thesis-layout h2, .thesis-layout h3, .thesis-layout h4, .thesis-layout h5, .thesis-layout h6',
    ),
  );
  const firstNumberedHeadingIndex = headings.findIndex(
    (heading) => heading.tagName === 'H1' && !heading.classList.contains('chapter'),
  );

  // Title
  const title = document.createElement('h2');
  title.textContent = 'Contents';
  contents.appendChild(title);

  const addEntry = (heading, number, indentLevel) => {
    const p = document.createElement('p');
    p.style.marginLeft = indentLevel > 0 ? `${indentLevel * 1.4}rem` : '0';

    const a = document.createElement('a');
    a.href = heading.id ? `#${heading.id}` : '#';
    a.textContent = number ? `${number} ${heading.textContent.trim()}` : heading.textContent.trim();
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

    addEntry(heading, parts.join('.'), Math.max(0, level - 1));
  }

  contents.dataset.tocBuilt = 'true';
};

buildToc();
document.addEventListener('DOMContentLoaded', buildToc);
document.addEventListener('afterprint', buildToc);
if (window.Paged) {
  document.addEventListener('pagedjs:rendered', buildToc);
}

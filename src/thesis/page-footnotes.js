(() => {
  let scheduled = false;
  const FOOTNOTE_HOST_CLASS = 'page-footnotes-host';

  function normalizeFootnoteKey(href) {
    if (!href) return '';

    const match = href.match(/^#ftnt(?:_ref)?(\d+)$/);
    return match ? match[1] : '';
  }

  function getSourceFootnoteIndex() {
    const index = new Map();
    const footnotes = document.querySelectorAll('.thesis-layout .footnotes p');

    footnotes.forEach((footnote) => {
      const marker = footnote.querySelector('a[href^="#ftnt_ref"]');
      const key = normalizeFootnoteKey(marker && marker.getAttribute('href'));

      if (!key || index.has(key)) return;
      index.set(key, footnote);
    });

    return index;
  }

  function getPageFootnoteKeys(pageElement) {
    const keys = [];
    const seen = new Set();

    pageElement.querySelectorAll('sup a[href^="#ftnt"]').forEach((anchor) => {
      const key = normalizeFootnoteKey(anchor.getAttribute('href'));
      if (!key || seen.has(key)) return;

      seen.add(key);
      keys.push(key);
    });

    return keys;
  }

  function stripDuplicateIds(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    node.querySelectorAll('[id]').forEach((element) => {
      element.removeAttribute('id');
    });

    if (node.hasAttribute('id')) {
      node.removeAttribute('id');
    }
  }

  function clearPageFootnotes(pageElement) {
    const marginBottom = pageElement.querySelector('.pagedjs_margin-bottom');
    if (marginBottom) {
      const footnoteHost = marginBottom.querySelector(`:scope > .${FOOTNOTE_HOST_CLASS}`);
      if (footnoteHost) {
        footnoteHost.remove();
      }
    }

    pageElement.removeAttribute('data-page-footnotes-key');
    pageElement.classList.remove('page-footnotes-active');
  }

  function renderPageFootnotes(pageElement, footnoteIndex) {
    const keys = getPageFootnoteKeys(pageElement);
    const pageKey = keys.join(',');

    if (!keys.length) {
      clearPageFootnotes(pageElement);
      return;
    }

    if (pageElement.getAttribute('data-page-footnotes-key') === pageKey) {
      return;
    }

    const marginBottom = pageElement.querySelector('.pagedjs_margin-bottom');
    if (!marginBottom) return;

    const footnoteList = document.createElement('div');
    footnoteList.className = 'page-footnotes';

    keys.forEach((key) => {
      const sourceFootnote = footnoteIndex.get(key);
      if (!sourceFootnote) return;

      const clonedFootnote = sourceFootnote.cloneNode(true);
      stripDuplicateIds(clonedFootnote);
      footnoteList.appendChild(clonedFootnote);
    });

    if (!footnoteList.childElementCount) {
      clearPageFootnotes(pageElement);
      return;
    }

    const footnoteHost = document.createElement('div');
    footnoteHost.className = FOOTNOTE_HOST_CLASS;
    footnoteHost.appendChild(footnoteList);

    marginBottom.replaceChildren(footnoteHost);
    pageElement.setAttribute('data-page-footnotes-key', pageKey);
    pageElement.classList.add('page-footnotes-active');
  }

  function insertInlineFootnotes(footnoteIndex) {
    document.querySelectorAll('sup a[href^="#ftnt"]').forEach((anchor) => {
      if (anchor.dataset.footnoteInserted) return;
      anchor.dataset.footnoteInserted = '1';

      const key = normalizeFootnoteKey(anchor.getAttribute('href'));
      const footnote = footnoteIndex.get(key);
      if (!footnote) return;

      const parentP = anchor.closest('p');
      if (!parentP) return;

      const clone = footnote.cloneNode(true);
      stripDuplicateIds(clone);

      const inlineNote = document.createElement('div');
      inlineNote.className = 'page-footnotes footnote-inline';
      inlineNote.dataset.footnoteInline = key;
      inlineNote.appendChild(clone);

      // Insert after any already-inserted footnotes following this paragraph
      let insertAfter = parentP;
      while (
        insertAfter.nextElementSibling &&
        insertAfter.nextElementSibling.classList.contains('footnote-inline')
      ) {
        insertAfter = insertAfter.nextElementSibling;
      }
      insertAfter.after(inlineNote);
    });
  }

  function applyPageFootnotes() {
    const footnoteIndex = getSourceFootnoteIndex();
    const pages = document.querySelectorAll('.pagedjs_page');
    if (pages.length) {
      pages.forEach((pageElement) => renderPageFootnotes(pageElement, footnoteIndex));
    }
    insertInlineFootnotes(footnoteIndex);
  }

  function scheduleApplyPageFootnotes() {
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyPageFootnotes();
    });
  }

  if (window.Paged && window.Paged.Handler && window.Paged.registerHandlers) {
    class PageFootnotesHandler extends window.Paged.Handler {
      afterRendered() {
        scheduleApplyPageFootnotes();
      }
    }

    window.Paged.registerHandlers(PageFootnotesHandler);
  }

  document.addEventListener('DOMContentLoaded', () => {
    scheduleApplyPageFootnotes();
  });

  window.addEventListener('load', () => {
    scheduleApplyPageFootnotes();
  });

  document.addEventListener('pagedjs:rendered', () => {
    scheduleApplyPageFootnotes();
  });

  scheduleApplyPageFootnotes();
})();

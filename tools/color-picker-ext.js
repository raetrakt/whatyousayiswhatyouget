// CodeMirror 6 extension: inline color swatches for hex color literals.
// Clicking a swatch opens a native color picker and writes the result back.

import { ViewPlugin, Decoration, WidgetType } from '@codemirror/view';

// Matches "  and ' delimited hex colors: "#fff", '#3300ff', etc.
const COLOR_RE = /["'](#[0-9a-fA-F]{3,8})["']/g;

// Expand #rgb → #rrggbb for <input type="color"> which only accepts 6-digit hex.
function _normalize(hex) {
  if (hex.length === 4) {
    return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex.slice(0, 7); // strip alpha if present
}

class ColorSwatchWidget extends WidgetType {
  constructor(color, from, to) {
    super();
    this.color = color;
    this.from = from;
    this.to = to;
  }

  eq(other) {
    return other.color === this.color && other.from === this.from && other.to === this.to;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-color-swatch';
    span.dataset.from = this.from;
    span.dataset.to = this.to;
    span.dataset.color = this.color;
    span.title = this.color;
    span.style.cssText = [
      'display:inline-block',
      'width:12px',
      'height:12px',
      `background:${this.color}`,
      'border:1px solid #0005',
      'cursor:pointer',
      'margin-right:4px',
      'flex-shrink:0',
    ].join(';');
    return span;
  }

  ignoreEvent() {
    return false; // let the plugin handle clicks
  }
}

function buildDecorations(view) {
  const widgets = [];
  const text = view.state.doc.toString();
  COLOR_RE.lastIndex = 0;
  let match;
  while ((match = COLOR_RE.exec(text)) !== null) {
    const color = match[1];
    const from = match.index + 1; // position of '#' (skip opening quote)
    const to = from + color.length;
    widgets.push(
      Decoration.widget({
        widget: new ColorSwatchWidget(color, from, to),
        side: -1, // render before the color text
      }).range(from),
    );
  }
  return Decoration.set(widgets, true);
}

export const colorPickerExt = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(update) {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      click(e, view) {
        const el = e.target.closest?.('.cm-color-swatch');
        if (!el) return false;

        const from = +el.dataset.from;
        const to = +el.dataset.to;
        const color = el.dataset.color;

        const input = document.createElement('input');
        input.type = 'color';
        input.value = _normalize(color);
        Object.assign(input.style, {
          position: 'fixed',
          opacity: '0',
          pointerEvents: 'none',
          width: '0',
          height: '0',
        });
        document.body.appendChild(input);

        // Live-update the editor on every change
        input.addEventListener('input', () => {
          const current = view.state.sliceDoc(from, to);
          view.dispatch({ changes: { from, to: from + current.length, insert: input.value } });
        });

        input.addEventListener('change', () => {
          document.body.removeChild(input);
        });

        input.click();
        return true;
      },
    },
  },
);

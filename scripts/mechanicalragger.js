/**
 * @package mechanical-ragger
 * @fileoverview Core class
 * @license MIT
 * @author Oak Studios
 */
class t {
  constructor({ container: t, onUpdate: e }) {
    ((this.sizeListener = new ResizeObserver(this.sizeListenerCallback)),
      (this.container = t),
      (this.updateCallback = e || function () {}));
  }
  sizeListener;
  containerBounds = new DOMRect(0, 0, 0, 0);
  updateCallback = () => {};
  _container;
  get container() {
    return this._container;
  }
  set container(t) {
    ((this._container = t), this.attachSizeListener());
  }
  get exclusionPolygon() {
    if ('undefined' == typeof window) return '';
    const t = this.ragAxis,
      e = window.getComputedStyle(this.container, null),
      i = Math.floor(parseFloat(e.getPropertyValue('line-height'))),
      r = e.getPropertyValue('writing-mode'),
      n = Math.floor(this.blockSize / i),
      s = Array(n).fill(null);
    let o = '0%',
      a = '100%';
    ('left' !== this.ragDirection && 'top' !== this.ragDirection) || ((o = '100%'), (a = '0%'));
    const c = this.blockSize,
      l = (t) => ('vertical-rl' === r ? c - t : t);
    return [
      ...s.map((t, e) => {
        const r = e * i,
          n = r + i,
          s = r + i / 2;
        return e % 2 == 0
          ? [
              [a, `${l(r)}px`],
              [a, `${l(n)}px`],
            ]
          : [[o, `${l(s)}px`]];
      }),
      [[a, `${l(this.blockSize)}px`]],
    ]
      .map((e) => e.map((e) => ('y' === t && e.reverse(), e.join(' '))))
      .flat()
      .join(',');
  }
  get ragDirection() {
    if ('undefined' == typeof window) return 'right';
    const t = window.getComputedStyle(this.container, null),
      e = t.getPropertyValue('text-align'),
      i = t.getPropertyValue('writing-mode'),
      r = t.getPropertyValue('direction');
    switch (i) {
      case 'vertical-lr':
      case 'vertical-rl':
        if ('left' === e) return 'bottom';
        if ('right' === e) return 'top';
        if ('ltr' === r)
          switch (e) {
            case 'start':
            case 'left':
              return 'bottom';
            case 'end':
            case 'right':
              return 'top';
          }
        if ('rtl' === r)
          switch (e) {
            case 'start':
            case 'left':
              return 'top';
            case 'end':
            case 'right':
              return 'bottom';
          }
      default:
        if ('left' === e) return 'right';
        if ('right' === e) return 'left';
        if ('ltr' === r)
          switch (e) {
            case 'start':
            case 'left':
              return 'right';
            case 'end':
            case 'right':
              return 'left';
          }
        if ('rtl' === r)
          switch (e) {
            case 'start':
            case 'left':
              return 'left';
            case 'end':
            case 'right':
              return 'right';
          }
    }
    return 'right';
  }
  get ragAxis() {
    return 'top' === this.ragDirection || 'bottom' === this.ragDirection ? 'y' : 'x';
  }
  get blockSize() {
    return 'y' === this.ragAxis ? this.containerBounds.width : this.containerBounds.height;
  }
  get cssProperties() {
    const t = this.exclusionPolygon,
      e = { right: 'right', left: 'left', bottom: 'right', top: 'left' }[this.ragDirection];
    return {
      clipPath: `polygon(${t})`,
      shapeOutside: `polygon(${t})`,
      inlineSize: 'var(--ragging-width, 1em)',
      blockSize: `${this.blockSize}px`,
      float: e,
    };
  }
  sizeListenerCallback = (t) => {
    for (let e of t) this.containerBounds = e.contentRect;
    this.update();
  };
  update = () => {
    const t = this.cssProperties;
    t && this.updateCallback(t);
  };
  attachSizeListener = () => {
    this.sizeListener.observe(this.container);
  };
  destroy = () => {
    this.sizeListener.disconnect();
  };
}
window.MechanicalRaggerCore = t;
/**
 * @package mechanical-ragger
 * @fileoverview Web Component entry
 * @license MIT
 * @author Oak Studios
 */ class e extends HTMLElement {
  constructor() {
    super();
    const e = this.attachShadow({ mode: 'closed' });
    ((this.exclusion = e.appendChild(document.createElement('div'))),
      (this.textRoot = e.appendChild(document.createElement('div'))),
      (this.textRoot.innerHTML = this.innerHTML),
      (this.ragger = new t({ container: this.textRoot, onUpdate: this.setExclusionStyles })));
  }
  exclusion;
  textRoot;
  ragger;
  connectedCallback = () => {
    this.ragger.update();
  };
  disconnectedCallback = () => {
    this.ragger.destroy();
  };
  setExclusionStyles = (t) => {
    Object.assign(this.exclusion.style, t);
  };
}
window.customElements.define('mechanical-ragger', e);

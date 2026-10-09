/* A small DOM/event harness for World behavior, not a browser or layout engine.
 * Bounding boxes are supplied by each test. Capture/bubble and focus transitions
 * are implemented so tests exercise the same overlay ownership as the DOM.
 */
class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture);
    const entries = this.listeners.get(name) ?? [];
    if (!entries.some((entry) => entry.callback === callback && entry.capture === capture)) entries.push({ callback, capture });
    this.listeners.set(name, entries);
  }
  removeEventListener(name, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture);
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((entry) => entry.callback !== callback || entry.capture !== capture));
  }
  dispatch(name, data = {}) {
    const event = {
      type: name, target: this, currentTarget: null, defaultPrevented: false,
      bubbles: !['focus', 'blur', 'pointerenter', 'pointerleave'].includes(name),
      stopped: false, immediateStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.immediateStopped = true; this.stopped = true; },
      ...data,
    };
    const path = [];
    for (let node = this; node; node = node.parentNode) path.push(node);
    const invoke = (node, capture) => {
      event.currentTarget = node;
      for (const entry of [...(node.listeners.get(name) ?? [])]) {
        if (entry.capture === capture) entry.callback(event);
        if (event.immediateStopped) break;
      }
    };
    for (const node of [...path].reverse()) {
      invoke(node, true);
      if (event.stopped) return event;
    }
    invoke(this, false);
    if (!event.stopped && event.bubbles) for (const node of path.slice(1)) {
      invoke(node, false);
      if (event.stopped) break;
    }
    return event;
  }
  dispatchEvent(event) { return !this.dispatch(event.type, event).defaultPrevented; }
}

function matchesSimple(node, selector) {
  if (!node?.tagName) return false;
  let remaining = selector.trim();
  if (!remaining) return false;
  const attrs = [...remaining.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/gu)];
  remaining = remaining.replace(/\[[^\]]+\]/gu, '');
  for (const [, name, value] of attrs) {
    if (!node.hasAttribute(name)) return false;
    if (value !== undefined && node.getAttribute(name) !== value) return false;
  }
  const tag = remaining.match(/^[a-z][a-z\d-]*/iu)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  for (const [, kind, value] of remaining.matchAll(/([.#])([\w-]+)/gu)) {
    if (kind === '.' && !node.classList.contains(value)) return false;
    if (kind === '#' && node.id !== value) return false;
  }
  return true;
}

export class FakeElement extends FakeEventTarget {
  constructor(tagName, doc = null) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.dataset = {};
    this._text = '';
    this.value = '';
    this.selected = false;
    this.disabled = false;
    this.hidden = false;
    this.inert = false;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.scrollTop = 0;
    this.style = {
      setProperty(name, value) { this[name] = String(value); },
      getPropertyValue(name) { return this[name] ?? ''; },
      removeProperty(name) { const previous = this[name] ?? ''; delete this[name]; return previous; },
    };
    const classes = () => new Set(this.className.split(/\s+/u).filter(Boolean));
    this.classList = {
      contains: (name) => classes().has(name),
      add: (...names) => { const set = classes(); names.forEach((name) => set.add(name)); this.className = [...set].join(' '); },
      remove: (...names) => { const set = classes(); names.forEach((name) => set.delete(name)); this.className = [...set].join(' '); },
      toggle: (name, force) => {
        const set = classes();
        const include = force ?? !set.has(name);
        if (include) set.add(name); else set.delete(name);
        this.className = [...set].join(' ');
        return include;
      },
    };
    if (this.tagName === 'CANVAS') this.getContext = () => null;
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] ?? null; }
  get lastChild() { return this.children.at(-1) ?? null; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get isConnected() { return Boolean(this.ownerDocument?.contains(this)); }
  get offsetParent() { return this.hidden ? null : this.parentElement; }
  append(...children) {
    for (let child of children) {
      if (child == null) continue;
      if (typeof child !== 'object') child = this.ownerDocument.createTextNode(String(child));
      child.remove?.();
      child.parentNode = this;
      this.children.push(child);
    }
  }
  appendChild(child) { this.append(child); return child; }
  prepend(...children) {
    for (const child of [...children].reverse()) { child.remove?.(); child.parentNode = this; this.children.unshift(child); }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = '';
    this.append(...children);
  }
  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index < 0) throw new Error('child_not_found');
    next.remove?.();
    next.parentNode = this;
    this.children[index] = next;
    previous.parentNode = null;
    return previous;
  }
  removeChild(child) { if (!this.children.includes(child)) throw new Error('child_not_found'); child.remove(); return child; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'tabindex') this.tabIndex = Number(value);
    if (name === 'disabled') this.disabled = true;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) { return name === 'class' ? this.className : this.attributes[name] ?? null; }
  hasAttribute(name) { return name === 'class' ? Boolean(this.className) : Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'disabled') this.disabled = false; }
  matches(selector) { return selector.split(',').some((part) => matchesSimple(this, part)); }
  closest(selector) { for (let node = this; node?.tagName; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) {
    const parts = selector.split(',').map((part) => part.trim());
    return findAll(this, (node) => node !== this && parts.some((part) => {
      const chain = part.split(/\s+(?![^[]*\])/u);
      if (!matchesSimple(node, chain.pop())) return false;
      let ancestor = node.parentNode;
      while (chain.length) {
        const next = chain.pop();
        while (ancestor && !matchesSimple(ancestor, next)) ancestor = ancestor.parentNode;
        if (!ancestor) return false;
        ancestor = ancestor.parentNode;
      }
      return true;
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  setRect({ left = 0, top = 0, width = 0, height = 0 } = {}) {
    this.rect = { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
    this.clientWidth = this.offsetWidth = width;
    this.clientHeight = this.offsetHeight = height;
    return this;
  }
  getBoundingClientRect() { return this.rect ?? { x: 0, y: 0, left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  focus() {
    const doc = this.ownerDocument;
    if (!doc || doc.activeElement === this) return;
    const previous = doc.activeElement;
    doc.activeElement = this;
    previous?.dispatch('blur', { relatedTarget: this });
    previous?.dispatch('focusout', { relatedTarget: this });
    this.dispatch('focus', { relatedTarget: previous });
    this.dispatch('focusin', { relatedTarget: previous });
  }
  blur() { this.ownerDocument?.body.focus(); }
  click() { if (!this.disabled) return this.dispatch('click'); }
}

export class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.nodeType = 9;
    this.documentElement = new FakeElement('html', this);
    this.documentElement.parentNode = this;
    this.body = new FakeElement('body', this);
    this.documentElement.append(this.body);
    this.children = [this.documentElement];
    this.activeElement = this.body;
    this.visibilityState = 'visible';
    this.defaultView = new FakeEventTarget();
    this.defaultView.document = this;
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  createElementNS(_namespace, tagName) { return this.createElement(tagName); }
  createTextNode(text) {
    const node = new FakeElement('#text', this);
    node.nodeType = 3;
    node.textContent = text;
    return node;
  }
  contains(node) { return this.documentElement.contains(node); }
  querySelector(selector) { return this.documentElement.querySelector(selector); }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
  getElementById(id) { return this.querySelector(`#${id}`); }
}

export function findAll(node, predicate, result = []) {
  if (!node) return result;
  if (predicate(node)) result.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, result);
  return result;
}
export function collectText(node) { return node?.textContent ?? ''; }
export function visibleText(node) {
  if (!node || node.hidden || node.tagName === 'DETAILS' || node.inert) return '';
  return (node._text ?? '') + (node.children ?? []).map(visibleText).join('');
}
export function buttonsNamed(root, label) { return findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === label); }
export function control(root, name) { return findAll(root, (node) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && node.getAttribute('name') === name)[0]; }
export function section(root, label) { return findAll(root, (node) => node.tagName === 'SECTION' && node.getAttribute('aria-label') === label)[0]; }
export function jsonResponse(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
export async function waitFor(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for the view');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

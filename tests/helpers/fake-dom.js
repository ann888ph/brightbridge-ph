// tests/helpers/fake-dom.js
//
// Minimal, dependency-free fake DOM sufficient to execute real production
// app.js code inside a Node vm sandbox. This is NOT a browser emulator --
// no real layout/rendering, no HTML parsing -- just enough object shape
// for production code to run against without throwing, with just enough
// fidelity for what these suites actually check:
//   - .value / .checked initial state and mutation
//   - .textContent / .innerHTML, including the real browser escaping
//     behavior that escapeHtml() in app.js depends on (set textContent,
//     read back innerHTML -- must come back HTML-escaped)
//   - .classList / .style.display / .disabled toggling
//   - .appendChild tracking <option> children for <select> elements
//
// No Node built-ins beyond what's already used elsewhere in the project;
// no external dependencies.

function escapeForInnerHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeElement(id, seed) {
  seed = seed || {};
  let rawHtml = '';
  let plainText; // undefined until textContent is explicitly set

  const el = {
    id,
    tagName: seed.tagName || null,
    _value: seed.value !== undefined ? seed.value : '',
    get value() { return this._value; },
    set value(v) { this._value = v; },
    checked: !!seed.checked,
    disabled: false,
    hidden: !!seed.hidden,
    style: { display: '' },
    options: [],
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        const has = this._set.has(c);
        const next = force === undefined ? !has : !!force;
        if (next) this._set.add(c); else this._set.delete(c);
        return next;
      },
      contains(c) { return this._set.has(c); }
    },

    get textContent() { return plainText !== undefined ? plainText : rawHtml; },
    set textContent(v) {
      plainText = v == null ? '' : String(v);
      rawHtml = escapeForInnerHtml(plainText);
    },
    get innerHTML() { return rawHtml; },
    set innerHTML(v) {
      rawHtml = v == null ? '' : String(v);
      plainText = undefined;
    },

    focus() {},
    scrollIntoView() {},
    appendChild(child) {
      if (child && child.tagName === 'option') this.options.push(child);
      return child;
    },
    insertAdjacentHTML() {},
    addEventListener() {},
    removeEventListener() {},
    _attributes: {},
    setAttribute(name, value) { this._attributes[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attributes, name) ? this._attributes[name] : null;
    },
    removeAttribute(name) { delete this._attributes[name]; },
    remove() {}
  };
  return el;
}

// `seed.values` maps element id -> initial .value ("grade": "Grade 4").
// `seed.checkedIds` lists ids that should start .checked = true.
function makeDocument(seed) {
  seed = seed || {};
  const values = seed.values || {};
  const checkedIds = seed.checkedIds || [];
  const elements = {};

  const doc = {
    _elements: elements,
    activeElement: null,
    body: makeElement('body'),
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = makeElement(id, { value: values[id], checked: checkedIds.includes(id) });
        wireFocusTracking(doc, elements[id]);
      }
      return elements[id];
    },
    createElement(tag) {
      const el = makeElement(null);
      el.tagName = tag;
      wireFocusTracking(doc, el);
      return el;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  return doc;
}

// Real .focus()/.blur() are no-ops in makeElement() (no layout, so nothing
// to render focus around) -- this wires them to actually update the owning
// document's .activeElement, which is enough fidelity for tests that check
// focus-return/focus-trap behavior (e.g. a modal restoring focus to its
// trigger on close) without needing a real browser.
function wireFocusTracking(doc, el) {
  el.focus = function () { doc.activeElement = this; };
  el.blur = function () { if (doc.activeElement === this) doc.activeElement = null; };
}

module.exports = { makeElement, makeDocument, escapeForInnerHtml };

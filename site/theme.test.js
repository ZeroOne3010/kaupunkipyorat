const assert = require("node:assert/strict");
require("./theme.js");

const {STORAGE_KEY, storedTheme, init} = globalThis.Theme;

assert.equal(storedTheme({getItem: () => "dark"}), "dark");
assert.equal(storedTheme({getItem: () => "unexpected"}), null);
assert.equal(storedTheme({getItem: () => { throw new Error("blocked"); }}), null);

function harness({stored = null, systemDark = false} = {}) {
  const listeners = {};
  const toggle = {
    checked: false,
    dataset: {},
    closest: () => label,
    addEventListener: (name, listener) => { listeners[name] = listener; }
  };
  const label = {title: ""};
  const document = {
    readyState: "complete",
    documentElement: {dataset: {}, style: {}},
    querySelector: selector => selector === "#theme-toggle" ? toggle : null
  };
  const media = {matches: systemDark, addEventListener: (name, listener) => { listeners.media = listener; }};
  const values = new Map(stored ? [[STORAGE_KEY, stored]] : []);
  const storage = {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)};
  init(document, media, storage);
  return {document, label, listeners, media, storage, toggle, values};
}

const system = harness({systemDark: true});
assert.equal(system.document.documentElement.dataset.theme, "dark");
assert.equal(system.toggle.checked, true);
system.media.matches = false;
system.listeners.media();
assert.equal(system.document.documentElement.dataset.theme, "light");

const saved = harness({stored: "light", systemDark: true});
assert.equal(saved.document.documentElement.dataset.theme, "light");
saved.toggle.checked = true;
saved.listeners.change();
assert.equal(saved.values.get(STORAGE_KEY), "dark");
assert.equal(saved.document.documentElement.dataset.theme, "dark");
assert.equal(saved.label.title, "Use light theme");
saved.media.matches = false;
saved.listeners.media();
assert.equal(saved.document.documentElement.dataset.theme, "dark");

console.log("theme tests passed");

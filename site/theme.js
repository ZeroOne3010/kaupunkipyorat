(function (root) {
  "use strict";

  const STORAGE_KEY = "city-bike-theme";

  function storedTheme(storage) {
    try {
      const value = storage?.getItem(STORAGE_KEY);
      return value === "dark" || value === "light" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function availableStorage(target) {
    try {
      return target.localStorage;
    } catch (_) {
      return null;
    }
  }

  function init(document, media, storage) {
    let preference = storedTheme(storage);

    function apply() {
      const dark = preference ? preference === "dark" : media.matches;
      const theme = dark ? "dark" : "light";
      const previousTheme = document.documentElement.dataset.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      const toggle = document.querySelector("#theme-toggle");
      if (toggle) {
        toggle.checked = dark;
        toggle.closest("label").title = dark ? "Use light theme" : "Use dark theme";
      }
      if (previousTheme && previousTheme !== theme && root.CustomEvent) {
        document.dispatchEvent(new root.CustomEvent("themechange", {detail: {theme}}));
      }
      return dark;
    }

    function connectToggle() {
      const toggle = document.querySelector("#theme-toggle");
      if (!toggle || toggle.dataset.themeReady) return;
      toggle.dataset.themeReady = "true";
      toggle.addEventListener("change", () => {
        preference = toggle.checked ? "dark" : "light";
        try { storage?.setItem(STORAGE_KEY, preference); } catch (_) { /* Theme still works for this visit. */ }
        apply();
      });
      apply();
    }

    apply();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", connectToggle, {once: true});
    else connectToggle();
    media.addEventListener?.("change", () => { if (!preference) apply(); });
    return {apply, connectToggle};
  }

  const api = {STORAGE_KEY, storedTheme, availableStorage, init};
  root.Theme = api;
  if (root.document && root.matchMedia) {
    init(root.document, root.matchMedia("(prefers-color-scheme: dark)"), availableStorage(root));
  }
})(typeof globalThis === "undefined" ? this : globalThis);

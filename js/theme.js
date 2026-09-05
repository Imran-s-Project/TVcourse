// ==========================================================================
// theme.js — Light/dark mode toggle. Loaded directly (non-module) in <head>
// on every page so the correct theme is applied before CSS paints (avoids a flash).
// ==========================================================================
(function () {
  var KEY = "tv-theme";

  function apply(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved === "light" ? "light" : "dark");

  function setTheme(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    apply(theme);
    updateButton();
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function updateButton() {
    var btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;
    var isLight = currentTheme() === "light";
    btn.innerHTML = isLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
    btn.setAttribute("aria-label", isLight ? "Enable dark mode" : "Enable light mode");
    btn.title = isLight ? "Dark mode" : "Light mode";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;
    updateButton();
    btn.addEventListener("click", function () {
      setTheme(currentTheme() === "light" ? "dark" : "light");
    });
  });

  window.tvSetTheme = setTheme;
})();

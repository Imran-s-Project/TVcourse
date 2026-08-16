// ==========================================================================
// router.js — Hash-based SPA router for Tech Verse Course
// Handles: #/course?id=xxx, #/home (default)
// All navigation uses window.location.hash — no page reloads for course pages
// ==========================================================================

// ---------- URL helpers ----------

/** Build a hash URL for the course page: #/course?id=xxx[&action=yyy] */
export function courseUrl(id, action) {
  let url = `#/course?id=${encodeURIComponent(id)}`;
  if (action) url += `&action=${encodeURIComponent(action)}`;
  return url;
}

/** Parse the current hash into { route, params }
 *  e.g. "#/course?id=abc&action=buy"  →  { route: "course", params: URLSearchParams }
 */
export function parseHash(hash = window.location.hash) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIdx = raw.indexOf("?");
  const path = (qIdx === -1 ? raw : raw.slice(0, qIdx)).replace(/^\//, "");
  const search = qIdx === -1 ? "" : raw.slice(qIdx);
  return { route: path || "home", params: new URLSearchParams(search) };
}

// ---------- Router class ----------

export class Router {
  /**
   * @param {Object} routes  Map of route name → async render function
   *                         Each fn receives (params: URLSearchParams, container: HTMLElement)
   * @param {HTMLElement} container  The element that page content is injected into
   */
  constructor(routes, container) {
    this._routes = routes;
    this._container = container;
    this._current = null;
    this._onHashChange = this._onHashChange.bind(this);
  }

  /** Start listening for hash changes and render the current route */
  start() {
    window.addEventListener("hashchange", this._onHashChange);
    this._render();
  }

  stop() {
    window.removeEventListener("hashchange", this._onHashChange);
  }

  _onHashChange() {
    this._render();
  }

  async _render() {
    const { route, params } = parseHash();
    const handler = this._routes[route] || this._routes["404"] || null;
    const hash = window.location.hash;
    const navigationChanged = hash !== this._current;
    this._current = hash;
    if (handler) {
      await handler(params, this._container);
      // Every navigation (Home ↔ Course ↔ About/Credits/Help/Privacy/Terms,
      // and even Course A → Course B) should land the user at the top of the
      // new page — otherwise clicking "About" from partway down the
      // homepage drops you into the middle of the About page instead of
      // its hero section.
      if (navigationChanged) window.scrollTo(0, 0);
    }
  }
}

// ---------- Convenience navigation ----------

/** Navigate to a hash route without a page reload */
export function navigate(hash) {
  window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
}

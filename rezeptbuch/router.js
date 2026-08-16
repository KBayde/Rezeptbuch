// ============================================================================
// Minimaler Hash-Router. Kein Framework nötig, kein Build-Schritt, und
// Hash-Routen ("#/rezepte/123") funktionieren auf jedem statischen Hosting
// ohne Server-Konfiguration (keine Rewrite-Regeln notwendig).
// ============================================================================

const routes = [];

/** pattern z. B. "/rezepte/:id" */
export function route(pattern, handler) {
  const paramNames = [];
  const regex = new RegExp(
    "^" +
      pattern.replace(/:[^/]+/g, (match) => {
        paramNames.push(match.slice(1));
        return "([^/]+)";
      }) +
      "$"
  );
  routes.push({ regex, paramNames, handler });
}

function currentPath() {
  const hash = window.location.hash || "#/";
  return hash.slice(1) || "/";
}

async function resolve() {
  const path = currentPath();
  for (const r of routes) {
    const match = path.match(r.regex);
    if (match) {
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
      await r.handler(params);
      return;
    }
  }
  window.location.hash = "#/";
}

export function navigate(path) {
  window.location.hash = `#${path}`;
}

let listenerAdded = false;

export function startRouter() {
  if (!listenerAdded) {
    window.addEventListener("hashchange", resolve);
    listenerAdded = true;
  }
  resolve();
}

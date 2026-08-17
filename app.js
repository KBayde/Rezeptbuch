import { getSession, onAuthStateChange, signOut } from "./db.js";
import { route, startRouter, navigate } from "./router.js";
import { renderLogin } from "./login.js";
import { renderRecipeList } from "./recipeList.js";
import { renderRecipeForm } from "./recipeForm.js";
import { renderRecipeDetail } from "./recipeDetail.js";

let currentSession = null;

function renderShell() {
  document.body.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a href="#/" class="brand"><img src="./logo-mascot.png" alt="" class="brand-logo" />CookCook</a>
        <button id="logout-btn" class="btn btn-ghost btn-small">Abmelden</button>
      </header>
      <main id="app" class="app-main"></main>
    </div>
  `;
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut();
  });
}

function renderAuthOnly() {
  document.body.innerHTML = `<main id="app" class="app-main app-main--auth"></main>`;
}

function registerRoutes() {
  route("/", async () => {
    const container = document.getElementById("app");
    await renderRecipeList(container);
  });
  route("/rezepte/neu", async () => {
    const container = document.getElementById("app");
    await renderRecipeForm(container);
  });
  route("/rezepte/:id/bearbeiten", async (params) => {
    const container = document.getElementById("app");
    await renderRecipeForm(container, { id: params.id });
  });
  route("/rezepte/:id", async (params) => {
    const container = document.getElementById("app");
    await renderRecipeDetail(container, { id: params.id });
  });
}

let routerStarted = false;

function showApp() {
  renderShell();
  if (!routerStarted) {
    registerRoutes();
    routerStarted = true;
  }
  startRouter();
}

function showLogin() {
  renderAuthOnly();
  const container = document.getElementById("app");
  renderLogin(container);
}

function showFatalError(err) {
  console.error("Startfehler:", err);
  document.body.innerHTML = `
    <main class="app-main app-main--auth">
      <div class="auth-screen">
        <div class="auth-card">
          <h1>Start fehlgeschlagen</h1>
          <p class="text-muted">
            Die App konnte sich nicht mit Supabase verbinden. Meist liegt es an
            falschen Werten in <code>js/config.js</code> (SUPABASE_URL /
            SUPABASE_ANON_KEY) oder daran, dass das Datenbankschema
            (schema.sql) noch nicht ausgeführt wurde.
          </p>
          <p class="form-error">${(err && err.message) || String(err)}</p>
        </div>
      </div>
    </main>
  `;
}

async function bootstrap() {
  try {
    currentSession = await getSession();
    if (currentSession) {
      showApp();
    } else {
      showLogin();
    }

    onAuthStateChange((session) => {
      const wasLoggedIn = Boolean(currentSession);
      const isLoggedIn = Boolean(session);
      currentSession = session;

      if (!wasLoggedIn && isLoggedIn) {
        showApp();
      } else if (wasLoggedIn && !isLoggedIn) {
        showLogin();
      }
    });
  } catch (err) {
    showFatalError(err);
  }
}

bootstrap();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline-Unterstützung ist ein "nice to have" – ein Fehler hier
      // darf die App nicht blockieren.
    });
  });
}

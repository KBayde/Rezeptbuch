import { getSession, onAuthStateChange, signOut, getWorkspace, setWorkspace } from "./db.js";
import { route, startRouter, navigate } from "./router.js";
import { renderLogin } from "./login.js";
import { renderRecipeList } from "./recipeList.js";
import { renderRecipeForm } from "./recipeForm.js";
import { renderRecipeDetail } from "./recipeDetail.js";
import { renderMealPlan } from "./mealPlan.js";
import { renderShoppingList } from "./shoppingList.js";
import { renderPhotoImport } from "./photoImport.js";
import { renderYoutubeImport } from "./youtubeImport.js";
import { renderLinkImport } from "./linkImport.js";
import { renderPdfImport } from "./pdfImport.js";
import { renderInventory } from "./inventory.js";
import { renderInventoryPhotoImport } from "./inventoryPhotoImport.js";
import { renderHouseholdCosts } from "./costs.js";
import { renderReceiptImport } from "./receiptImport.js";
import { renderSettings } from "./settings.js";

let currentSession = null;

function renderShell() {
  document.body.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a href="#/" class="brand"><img src="./logo-mascot.png" alt="" class="brand-logo" />clevulo</a>
        <nav class="topbar-nav">
          <a href="#/">Rezepte</a>
          <a href="#/wochenplan">Wochenplan</a>
          <a href="#/einkaufsliste">Einkaufsliste</a>
          <a href="#/vorrat">Vorrat</a>
          <a href="#/haushaltskosten">Kosten</a>
<a href="#/einstellungen">⚙️ Einstellungen</a>
        </nav>
        <div class="workspace-switch" id="workspace-switch"><button type="button" data-workspace="real" class="workspace-btn">Real</button><button type="button" data-workspace="sandbox" class="workspace-btn">Sandbox</button></div>
        <button id="logout-btn" class="btn btn-ghost btn-small">Abmelden</button>
      </header>
      <main id="app" class="app-main"></main>
    </div>
  `;
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut();
  });
  const workspaceSwitch = document.getElementById("workspace-switch");
  if (workspaceSwitch) {
    const updateWorkspaceUI = () => {
      const current = getWorkspace();
      workspaceSwitch.querySelectorAll(".workspace-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.workspace === current);
      });
      document.body.classList.toggle("sandbox-mode", current === "sandbox");
    };
    updateWorkspaceUI();
    workspaceSwitch.querySelectorAll(".workspace-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setWorkspace(btn.dataset.workspace);
        location.reload();
      });
    });
  }
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
  route("/rezepte/foto-import", async () => {
    const container = document.getElementById("app");
    await renderPhotoImport(container);
  });
  route("/rezepte/youtube-import", async () => {
    const container = document.getElementById("app");
    await renderYoutubeImport(container);
  });
  route("/rezepte/link-import", async () => {
    const container = document.getElementById("app");
    await renderLinkImport(container);
  });
  route("/rezepte/pdf-import", async () => {
    const container = document.getElementById("app");
    await renderPdfImport(container);
  });
  route("/rezepte/:id/bearbeiten", async (params) => {
    const container = document.getElementById("app");
    await renderRecipeForm(container, { id: params.id });
  });
  route("/rezepte/:id", async (params) => {
    const container = document.getElementById("app");
    await renderRecipeDetail(container, { id: params.id });
  });
  route("/wochenplan", async () => {
    const container = document.getElementById("app");
    await renderMealPlan(container);
  });
  route("/einkaufsliste", async () => {
    const container = document.getElementById("app");
    await renderShoppingList(container);
  });
  route("/vorrat", async () => {
    const container = document.getElementById("app");
    await renderInventory(container);
  });
route("/vorrat/foto-import", async () => {
const container = document.getElementById("app");
await renderInventoryPhotoImport(container);
});
  route("/haushaltskosten", async () => {
    const container = document.getElementById("app");
    await renderHouseholdCosts(container);
  });
    route("/einkaufsliste/kassenbon-scan", async () => {
          const container = document.getElementById("app");
          await renderReceiptImport(container);
    });
route("/einstellungen", async () => {
  const container = document.getElementById("app");
  await renderSettings(container);
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

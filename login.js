import { signIn } from "./db.js";
import { escapeHtml } from "./utils.js";

export function renderLogin(container) {
  container.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand">
          <span class="auth-brand-mark">🍲</span>
          <h1>Unser Rezeptbuch</h1>
          <p class="text-muted">Melde dich an, um eure Sammlung zu öffnen.</p>
        </div>
        <form id="login-form" class="stack-md">
          <label class="field">
            <span>E-Mail</span>
            <input type="email" name="email" required autocomplete="email" />
          </label>
          <label class="field">
            <span>Passwort</span>
            <input type="password" name="password" required autocomplete="current-password" />
          </label>
          <p id="login-error" class="form-error" hidden></p>
          <button type="submit" class="btn btn-primary btn-block">Anmelden</button>
        </form>
        <p class="text-muted text-small auth-hint">
          Noch keinen Zugang? Der Account wird einmalig direkt in Supabase angelegt
          (siehe DEPLOYMENT.md).
        </p>
      </div>
    </div>
  `;

  const form = container.querySelector("#login-form");
  const errorEl = container.querySelector("#login-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Anmelden…";

    const formData = new FormData(form);
    try {
      await signIn(formData.get("email"), formData.get("password"));
      // Der Auth-State-Listener in app.js übernimmt die Weiterleitung.
    } catch (err) {
      errorEl.textContent = mapAuthError(err);
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Anmelden";
    }
  });
}

function mapAuthError(err) {
  const msg = err?.message || "";
  if (msg.includes("Invalid login credentials")) {
    return "E-Mail oder Passwort ist falsch.";
  }
  return escapeHtml(msg || "Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
}

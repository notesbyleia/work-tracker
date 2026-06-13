// auth.js — login/signup gate + cloud sync for Work Tracker.
// Loads before app.js. Exposes window.WorkTrackerCloud for app.js to use.

(() => {
"use strict";

const { createClient } = window.supabase;
const cfg = window.SUPABASE_CONFIG || {};
const LOCAL_KEY = "work-tracker-v2";          // matches app.js STORAGE_KEY
const MIGRATED_FLAG = "work-tracker-migrated";
const SYNC_PREF_KEY = "work-tracker.sync-preference";
const LOCAL_ONLY = "local-only";

if (!cfg.url || cfg.url.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    "<p style='padding:2rem;font-family:sans-serif'>Supabase is not configured yet. " +
    "Edit <code>supabase-config.js</code> with your project URL and anon key.</p>";
  return;
}

const client = createClient(cfg.url, cfg.anonKey);


// ─── Auth gate UI ──────────────────────────────────────────────────────────
// Shows the login form as an OVERLAY without destroying the app's HTML,
// so no page reload is ever needed (which previously caused a reload loop).

function renderAuthGate(message = "") {
  // Hide the app content while logged out.
  document.querySelectorAll("body > header, body > main").forEach((el) => {
    el.style.display = "none";
  });

  let gate = document.querySelector("#auth-gate");
  if (gate) { gate.style.display = "grid"; setMessage(message); return; }

  gate = document.createElement("div");
  gate.id = "auth-gate";
  gate.className = "auth-gate";
  gate.innerHTML = `
    <form id="auth-form" class="auth-card">
      <h1>Work Tracker</h1>
      <p class="auth-sub">Sign in to sync across your devices.</p>
      <label>Email <input name="email" type="email" required autocomplete="email" /></label>
      <label>Password <input name="password" type="password" required minlength="6" autocomplete="current-password" /></label>
      <div class="auth-actions">
        <button type="submit" data-mode="signin">Log in</button>
        <button type="submit" data-mode="signup" class="secondary">Sign up</button>
      </div>
      <button type="button" id="skip-sync" class="secondary">Continue without sync</button>
      <p id="auth-message" class="auth-message">${message}</p>
    </form>`;
  document.body.append(gate);

  const form = document.querySelector("#auth-form");
  let mode = "signin";
  form.querySelectorAll("button[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => { mode = btn.dataset.mode; });
  });

  form.querySelector("#skip-sync").addEventListener("click", async () => {
    localStorage.setItem(SYNC_PREF_KEY, LOCAL_ONLY);
    setMessage("Using this device only…");
    await bootLocalOnly();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    localStorage.removeItem(SYNC_PREF_KEY);
    const { email, password } = Object.fromEntries(new FormData(form));
    setMessage(mode === "signup" ? "Creating account…" : "Logging in…");

    const fn = mode === "signup" ? "signUp" : "signInWithPassword";
    const { data, error } = await client.auth[fn]({ email, password });

    if (error) { setMessage(error.message); return; }
    if (mode === "signup" && !data.session) {
      setMessage("Check your email to confirm your account, then log in.");
      return;
    }
    // Session established — boot directly (no reload).
    if (data.session) {
      await bootOnce(data.session);
    }
  });
}

function hideAuthGate() {
  const gate = document.querySelector("#auth-gate");
  if (gate) gate.style.display = "none";
  document.querySelectorAll("body > header, body > main").forEach((el) => {
    el.style.display = "";
  });
}

function setMessage(text) {
  const el = document.querySelector("#auth-message");
  if (el) el.textContent = text;
}

// ─── Cloud storage API (used by app.js) ──────────────────────────────────────

let currentUserId = null;

async function cloudLoad() {
  try {
    const query = client
      .from("tracker_state")
      .select("data")
      .eq("user_id", currentUserId)
      .maybeSingle();

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timed out after 8s")), 8000)
    );

    const { data, error } = await Promise.race([query, timeout]);

    if (error) {
      console.error("cloudLoad", error);
      return null;
    }
    if (!data) return null;
    return data.data;
  } catch (err) {
    console.error("cloudLoad failed", err);
    return null;
  }
}

async function cloudSave(state) {
  try {
    const query = client
      .from("tracker_state")
      .upsert({ user_id: currentUserId, data: state }, { onConflict: "user_id" });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timed out after 8s")), 8000)
    );

    const { error } = await Promise.race([query, timeout]);

    if (error) {
      console.error("cloudSave", error);
      showCloudError("Save failed: " + error.message);
    }
  } catch (err) {
    console.error("cloudSave failed", err);
    showCloudError("Save failed: " + err.message);
  }
}

function showCloudError(msg) {
  let banner = document.querySelector("#cloud-error");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "cloud-error";
    banner.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#c0392b;color:#fff;" +
      "padding:10px 14px;font:13px/1.4 system-ui,sans-serif;";
    document.body.append(banner);
  }
  banner.textContent = msg;
  setTimeout(() => banner.remove(), 8000);
}

// One-time migration: if cloud is empty and localStorage has data, push it up.
async function maybeMigrate() {
  if (localStorage.getItem(MIGRATED_FLAG)) return;
  const cloud = await cloudLoad();
  const hasCloudData = cloud && (cloud.portfolios?.length || cloud.workstreams?.length || cloud.tasks?.length);
  if (hasCloudData) { localStorage.setItem(MIGRATED_FLAG, "1"); return; }

  const localRaw = localStorage.getItem(LOCAL_KEY);
  if (localRaw) {
    try {
      const local = JSON.parse(localRaw);
      if (local.portfolios?.length || local.workstreams?.length || local.tasks?.length) {
        await cloudSave(local);
      }
    } catch { /* ignore bad local data */ }
  }
  localStorage.setItem(MIGRATED_FLAG, "1");
}

// ─── Boot ─────────────────────────────────────────────────────────────────

async function bootApp(session) {
  currentUserId = session.user.id;
  await maybeMigrate();

  // Expose the cloud API for app.js, then load app.js.
  window.WorkTrackerCloud = {
    userEmail: session.user.email,
    load: cloudLoad,
    save: cloudSave,
    signOut: () => client.auth.signOut(),
  };

  // app.js reads window.WorkTrackerCloud if present; signal it can run.
  document.dispatchEvent(new CustomEvent("work-tracker-cloud-ready"));
}

let booted = false;

// Boot the app once, in place. No reloads.
async function bootOnce(session) {
  if (booted) return;
  booted = true;
  hideAuthGate();
  await bootApp(session);
}

async function bootLocalOnly() {
  if (booted) return;
  booted = true;
  window.WorkTrackerCloud = null;
  hideAuthGate();
  document.dispatchEvent(new CustomEvent("work-tracker-cloud-ready"));
}

client.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") {
    booted = false;
    window.WorkTrackerCloud = null;
    renderAuthGate("Signed out.");
  }
  // Note: we deliberately do NOT boot on SIGNED_IN here, to avoid double-boot.
  // Initial load and the login form's submit handler both call bootOnce directly.
});

// Initial check on page load.
(async () => {
  if (localStorage.getItem(SYNC_PREF_KEY) === LOCAL_ONLY) {
    await bootLocalOnly();
    return;
  }

  const { data } = await client.auth.getSession();
  if (data.session) {
    await bootOnce(data.session);
  } else {
    renderAuthGate();
  }
})();

})();

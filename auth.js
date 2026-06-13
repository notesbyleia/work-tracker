// auth.js — login/signup gate + cloud sync for Work Tracker.
// Loads before app.js. Exposes window.WorkTrackerCloud for app.js to use.

(() => {
"use strict";

const { createClient } = window.supabase;
const cfg = window.SUPABASE_CONFIG || {};
const LOCAL_KEY = "work-tracker-v2";          // matches app.js STORAGE_KEY
const MIGRATED_FLAG = "work-tracker-migrated";

if (!cfg.url || cfg.url.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    "<p style='padding:2rem;font-family:sans-serif'>Supabase is not configured yet. " +
    "Edit <code>supabase-config.js</code> with your project URL and anon key.</p>";
  return;
}

const client = createClient(cfg.url, cfg.anonKey);

// ─── On-screen debug log (mobile-friendly) ───────────────────────────────────

const DEBUG = true;

function dbg(msg) {
  if (!DEBUG) return;
  let panel = document.querySelector("#debug-log");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "debug-log";
    panel.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow:auto;z-index:99999;" +
      "background:#111;color:#0f0;padding:8px 10px 12px;font:11px/1.4 monospace;" +
      "border-top:2px solid #0f0;";
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;color:#fff;margin-bottom:4px;";
    header.innerHTML = "<strong>debug log</strong>";
    const close = document.createElement("button");
    close.textContent = "hide";
    close.style.cssText = "background:#333;color:#fff;border:none;padding:2px 8px;border-radius:4px;";
    close.onclick = () => panel.remove();
    header.append(close);
    panel.append(header);
    const body = document.createElement("div");
    body.id = "debug-log-body";
    panel.append(body);
    document.body.append(panel);
  }
  const line = document.createElement("div");
  const t = new Date().toLocaleTimeString();
  line.textContent = `[${t}] ${msg}`;
  document.querySelector("#debug-log-body")?.append(line);
}

// Make dbg available globally so app.js can use it too.
window.__dbg = dbg;

dbg("auth.js loaded; supabase client created");


// ─── Auth gate UI ──────────────────────────────────────────────────────────

function renderAuthGate(message = "") {
  document.body.innerHTML = `
    <div class="auth-gate">
      <form id="auth-form" class="auth-card">
        <h1>Work Tracker</h1>
        <p class="auth-sub">Sign in to sync across your devices.</p>
        <label>Email <input name="email" type="email" required autocomplete="email" /></label>
        <label>Password <input name="password" type="password" required minlength="6" autocomplete="current-password" /></label>
        <div class="auth-actions">
          <button type="submit" data-mode="signin">Log in</button>
          <button type="submit" data-mode="signup" class="secondary">Sign up</button>
        </div>
        <p id="auth-message" class="auth-message">${message}</p>
      </form>
    </div>`;

  const form = document.querySelector("#auth-form");
  let mode = "signin";
  form.querySelectorAll("button[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => { mode = btn.dataset.mode; });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { email, password } = Object.fromEntries(new FormData(form));
    setMessage(mode === "signup" ? "Creating account…" : "Logging in…");

    const fn = mode === "signup" ? "signUp" : "signInWithPassword";
    const { data, error } = await client.auth[fn]({ email, password });

    if (error) { setMessage(error.message); return; }
    if (mode === "signup" && !data.session) {
      setMessage("Check your email to confirm your account, then log in.");
      return;
    }
    // Session established — onAuthStateChange will boot the app.
  });
}

function setMessage(text) {
  const el = document.querySelector("#auth-message");
  if (el) el.textContent = text;
}

// ─── Cloud storage API (used by app.js) ──────────────────────────────────────

let currentUserId = null;

async function cloudLoad() {
  dbg(`cloudLoad: querying for user ${currentUserId?.slice(0, 8)}…`);
  const { data, error } = await client
    .from("tracker_state")
    .select("data")
    .eq("user_id", currentUserId)
    .maybeSingle();
  if (error) {
    dbg(`cloudLoad ERROR: ${error.message} (code ${error.code || "?"})`);
    console.error("cloudLoad", error);
    return null;
  }
  if (!data) { dbg("cloudLoad: no row yet (empty)"); return null; }
  const d = data.data || {};
  dbg(`cloudLoad OK: ${d.portfolios?.length || 0} portfolios, ${d.tasks?.length || 0} tasks`);
  return data.data;
}

async function cloudSave(state) {
  const counts = `${state.portfolios?.length || 0}p/${state.workstreams?.length || 0}w/${state.tasks?.length || 0}t`;
  dbg(`cloudSave: writing ${counts} for user ${currentUserId?.slice(0, 8)}…`);
  const { error } = await client
    .from("tracker_state")
    .upsert({ user_id: currentUserId, data: state }, { onConflict: "user_id" });
  if (error) {
    dbg(`cloudSave ERROR: ${error.message} (code ${error.code || "?"})`);
    console.error("cloudSave", error);
    showCloudError("Save failed: " + error.message);
  } else {
    dbg(`cloudSave OK (${counts})`);
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
  dbg(`bootApp: logged in as ${session.user.email}`);
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

client.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session && !booted) {
    // Fresh login from the auth gate — reload to restore the app's HTML cleanly.
    location.reload();
  }
  if (event === "SIGNED_OUT") {
    location.reload();
  }
});

let booted = false;

// Initial check on page load.
(async () => {
  const { data } = await client.auth.getSession();
  if (data.session) {
    booted = true;
    await bootApp(data.session);
  } else {
    renderAuthGate();
  }
})();

})();

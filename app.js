(() => {
"use strict";

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "work-tracker-v2";
const LEGACY_STORAGE_KEY = "reply-radar-v1";
const DAY = 24 * 60 * 60 * 1000;
const TASK_STATUSES = ["waiting", "chased", "with-me", "received", "completed"];
const INPUT_STATUSES = ["waiting", "chased", "received", "not-needed"];
const PORTFOLIO_COLORS = ["#b8e0d2","#f7d6e0","#cdb4db","#ffd6a5","#bde0fe","#caffbf","#fff1a8","#d7c0ae","#a8dadc","#ffc8dd"];
const CSV_FIELDS = ["portfolioId","portfolio","workstreamId","workstream","workstreamDeadline","workstreamEffort","taskId","task","taskDeadline","expectedDelay","taskStatus","inputId","inputName","inputStatus","chaseCount","lastChasedAt"];

// ─── Default & sample state ───────────────────────────────────────────────────

const defaultState = { portfolios: [], workstreams: [], tasks: [] };

const sampleState = {
  portfolios: [
    { id: "pf-corporate", name: "Corporate", createdAt: now() },
    { id: "pf-finance",   name: "Finance",   createdAt: now() },
  ],
  workstreams: [
    { id: "ws-planning", portfolioId: "pf-corporate", name: "Quarterly planning", deadline: offsetDate(8), effort: 4, createdAt: now() },
    { id: "ws-budget",   portfolioId: "pf-finance",   name: "Budget review",      deadline: offsetDate(3), effort: 2, createdAt: now() },
  ],
  tasks: [
    makeTask("ws-planning", "Draft briefing note",              offsetDate(2),  1, "HR, Finance", "chased"),
    makeTask("ws-planning", "Review timeline assumptions",      offsetDate(5),  2, "",            "with-me"),
    makeTask("ws-budget",   "Consolidate headcount assumptions", offsetDate(0), 0, "HR, Finance", "received"),
    makeTask("ws-budget",   "Send final clearance note",        offsetDate(-2), 0, "",            "completed"),
  ],
};

// ─── Runtime state ────────────────────────────────────────────────────────────

let state = loadState();
let pointerDragTaskId = "";
let previewMode = false;
let prePreviewState = null;
let calendarMonth = startOfMonth(new Date());   // first day of the month shown in Calendar
let selectedCalendarDate = null;                 // YYYY-MM-DD the user tapped, if any

// ─── DOM refs ────────────────────────────────────────────────────────────────
// Only reference elements that actually exist in index.html

const els = {
  seedData:            document.querySelector("#seed-data"),
  clearData:           document.querySelector("#clear-data"),
  portfolioForm:       document.querySelector("#portfolio-form"),
  workstreamForm:      document.querySelector("#workstream-form"),
  taskForm:            document.querySelector("#task-form"),
  workstreamPortfolio: document.querySelector("#workstream-portfolio"),
  taskWorkstream:      document.querySelector("#task-workstream"),
  downloadData:        document.querySelector("#download-data"),
  recoverData:         document.querySelector("#recover-data"),
  uploadData:          document.querySelector("#upload-data"),
  importStatus:        document.querySelector("#import-status"),
  peopleSuggestions:   document.querySelector("#people-suggestions"),
  tabs:                document.querySelectorAll(".tab"),
  views:               document.querySelectorAll(".view"),
  // Dashboard lanes (index.html uses waiting-list / with-me-list)
  waitingList:         document.querySelector("#waiting-list"),
  withMeList:          document.querySelector("#with-me-list"),
  // Other views
  priorityList:        document.querySelector("#priority-list"),
  completedList:       document.querySelector("#completed-list"),
  portfolioBoard:      document.querySelector("#portfolio-board"),
  taskList:            document.querySelector("#task-list"),
  peopleList:          document.querySelector("#people-list"),
  calendarViewer:      document.querySelector("#calendar-viewer"),
  previewDialog:       document.querySelector("#preview-dialog"),
  previewBoard:        document.querySelector("#preview-board"),
  closePreview:        document.querySelector("#close-preview"),
  // Metrics
  metricChase:         document.querySelector("#metric-chase"),
  metricRisk:          document.querySelector("#metric-risk"),
  metricBack:          document.querySelector("#metric-back"),
  metricHours:         document.querySelector("#metric-hours"),
};

// ─── Init ─────────────────────────────────────────────────────────────────────

// If the cloud layer (auth.js) is present, load the user's state from Supabase
// before first render. Otherwise fall back to localStorage.
async function init() {
  try {
    if (window.WorkTrackerCloud) {
      const cloudState = await window.WorkTrackerCloud.load();
      if (cloudState) state = cloudState;
      addSignOutButton();
    }
    migrateState();
    render();
  } catch (err) {
    console.error("Startup error:", err);
  }
}

function addSignOutButton() {
  const actions = document.querySelector(".header-actions");
  if (!actions || document.querySelector("#sign-out")) return;
  const btn = document.createElement("button");
  btn.id = "sign-out";
  btn.className = "ghost";
  btn.textContent = `Sign out (${window.WorkTrackerCloud.userEmail})`;
  btn.addEventListener("click", () => window.WorkTrackerCloud.signOut());
  actions.append(btn);
}

// If auth.js is on the page, wait for it to establish a session and set up
// the cloud API before initialising. Otherwise (no auth), init immediately.
if (document.querySelector('script[src*="auth.js"]')) {
  if (window.WorkTrackerCloud) {
    init();
  } else {
    document.addEventListener("work-tracker-cloud-ready", init, { once: true });
  }
} else {
  init();
}

// ─── Event listeners ──────────────────────────────────────────────────────────

els.seedData.addEventListener("click", () => {
  prePreviewState = structuredClone(state);
  state = structuredClone(sampleState);
  previewMode = true;
  if (els.previewDialog) {
    renderPreviewDialog();
    els.previewDialog.showModal();
  } else {
    render();
  }
});

if (els.closePreview) {
  els.closePreview.addEventListener("click", () => {
    previewMode = false;
    state = prePreviewState ? structuredClone(prePreviewState) : loadState();
    prePreviewState = null;
    migrateState();
    els.previewDialog?.close();
    render();
  });
}

els.clearData.addEventListener("click", () => {
  if (!confirm("Reset all locally saved tracker data?")) return;
  previewMode = false;
  prePreviewState = null;
  state = structuredClone(defaultState);
  saveState();
  render();
});

els.portfolioForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state.portfolios.push({ id: crypto.randomUUID(), name: data.name.trim(), createdAt: now() });
  event.currentTarget.reset();
  saveState();
  render();
});

els.workstreamForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state.workstreams.push({
    id: crypto.randomUUID(),
    portfolioId: data.portfolioId,
    name: data.name.trim(),
    deadline: data.deadline,
    effort: Number(data.effort),
    createdAt: now(),
  });
  event.currentTarget.reset();
  saveState();
  render();
});

els.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!taskDeadlineIsValid(data.workstreamId, data.dueDate)) return;
  state.tasks.push(makeTask(
    data.workstreamId, data.title, data.dueDate,
    Number(data.expectedDelay),
    data.noInputs ? "" : data.inputs,
    data.status,
  ));
  event.currentTarget.reset();
  syncNoInputsField();
  saveState();
  render();
});

els.taskForm.elements.noInputs.addEventListener("change", syncNoInputsField);

els.downloadData.addEventListener("click", () => downloadCsv());

if (els.recoverData) {
  els.recoverData.addEventListener("click", () => {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) { alert("No previous data found."); return; }
    try {
      state = JSON.parse(legacy);
      migrateState();
      saveState();
      render();
    } catch {
      alert("Could not recover previous data.");
    }
  });
}

els.uploadData.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const mode = document.querySelector("[name='importMode']:checked")?.value || "merge";
  try {
    const imported = await readImportFile(file);
    previewMode = false;
    state = mode === "replace" ? imported : mergeImportedState(state, imported);
    migrateState();
    render();
    setImportStatus(mode === "replace"
      ? "Uploaded file replaced all tracker data."
      : "Uploaded entries were added to existing data.");
  } catch (error) {
    setImportStatus(error.message || "Could not import that file.");
  } finally {
    event.target.value = "";
  }
});

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    els.tabs.forEach((t) => t.classList.remove("active"));
    els.views.forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.view}-view`)?.classList.add("active");
  });
});

document.addEventListener("click", (event) => {
  // Calendar month navigation
  const nav = event.target.closest("[data-cal-nav]");
  if (nav) {
    const dir = nav.dataset.calNav;
    if (dir === "prev")  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    if (dir === "next")  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    if (dir === "today") { calendarMonth = startOfMonth(new Date()); selectedCalendarDate = today(); }
    renderCalendar();
    return;
  }

  // Calendar day selection (toggle)
  const cell = event.target.closest("[data-cal-date]");
  if (cell) {
    const d = cell.dataset.calDate;
    selectedCalendarDate = selectedCalendarDate === d ? null : d;
    renderCalendar();
    return;
  }

  const action = event.target.dataset.action;
  const id     = event.target.dataset.id;
  if (!action || !id) return;

  const portfolio = state.portfolios.find((p) => p.id === id);
  if (portfolio && action === "edit-portfolio")        return editEntity(portfolio);
  if (portfolio && action === "cancel-portfolio-edit") return cancelEdit(portfolio);
  if (portfolio && action === "delete-portfolio")      return deletePortfolio(portfolio);

  const workstream = state.workstreams.find((w) => w.id === id);
  if (workstream && action === "edit-workstream")        return editEntity(workstream);
  if (workstream && action === "cancel-workstream-edit") return cancelEdit(workstream);
  if (workstream && action === "delete-workstream")      return deleteWorkstream(workstream);

  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  if (action === "edit-task")        return editEntity(task);
  if (action === "cancel-task-edit") return cancelEdit(task);
  if (action === "delete-task")      return deleteTask(task);
  if (action === "waiting")  updateTaskStatus(task, "waiting");
  if (action === "chase")    updateTaskStatus(task, "chased");
  if (action === "receive")  updateTaskStatus(task, "received");
  if (action === "complete") updateTaskStatus(task, "completed");
  saveState();
  render();
});

document.addEventListener("submit", (event) => {
  if (event.target.matches(".edit-portfolio-form")) {
    event.preventDefault();
    const portfolio = state.portfolios.find((p) => p.id === event.target.dataset.id);
    const data = Object.fromEntries(new FormData(event.target));
    portfolio.name = data.name.trim();
    delete portfolio.editing;
    saveState(); render(); return;
  }

  if (event.target.matches(".edit-workstream-form")) {
    event.preventDefault();
    const workstream = state.workstreams.find((w) => w.id === event.target.dataset.id);
    const data = Object.fromEntries(new FormData(event.target));
    workstream.portfolioId = data.portfolioId;
    workstream.name        = data.name.trim();
    workstream.deadline    = data.deadline;
    workstream.effort      = Number(data.effort);
    delete workstream.editing;
    saveState(); render(); return;
  }

  if (event.target.matches(".edit-task-form")) {
    event.preventDefault();
    const task = state.tasks.find((t) => t.id === event.target.dataset.id);
    const data = Object.fromEntries(new FormData(event.target));
    if (!taskDeadlineIsValid(data.workstreamId, data.dueDate)) return;
    task.workstreamId  = data.workstreamId;
    task.title         = data.title.trim();
    task.dueDate       = data.dueDate;
    task.expectedDelay = Number(data.expectedDelay);
    updateTaskStatus(task, data.status);
    task.inputs = collectInputs(event.target);
    delete task.editing;
    saveState(); render();
  }
});

document.addEventListener("change", (event) => {
  if (!event.target.matches(".edit-task-form [name='noInputs']")) return;
  const form = event.target.closest(".edit-task-form");
  const newInputs = form.elements.newInputs;
  newInputs.disabled = event.target.checked;
  if (event.target.checked) newInputs.value = "";
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[list='people-suggestions']")) renderPeopleSuggestions(event.target.value);
});

document.addEventListener("focusin", (event) => {
  if (event.target.matches("[list='people-suggestions']")) renderPeopleSuggestions(event.target.value);
});

// ─── Drag & drop ─────────────────────────────────────────────────────────────

document.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".task-card");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.id);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
});

document.addEventListener("dragend", (event) => {
  event.target.closest(".task-card")?.classList.remove("dragging");
  document.querySelectorAll(".lane.drag-over").forEach((l) => l.classList.remove("drag-over"));
});

document.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button, input, select, textarea")) return;
  const card = event.target.closest(".task-card[draggable='true']");
  if (!card) return;
  pointerDragTaskId = card.dataset.id;
  card.classList.add("dragging");
});

document.addEventListener("pointerup", (event) => {
  if (!pointerDragTaskId) return;
  const lane = event.target.closest(".lane[data-lane]");
  document.querySelectorAll(".task-card.dragging").forEach((c) => c.classList.remove("dragging"));
  if (!lane) { pointerDragTaskId = ""; return; }
  const task = state.tasks.find((t) => t.id === pointerDragTaskId);
  pointerDragTaskId = "";
  if (!task) return;
  updateTaskStatus(task, lane.dataset.lane);
  saveState();
  render();
});

document.querySelectorAll(".lane[data-lane]").forEach((lane) => {
  lane.addEventListener("dragover",  (e) => { e.preventDefault(); lane.classList.add("drag-over"); e.dataTransfer.dropEffect = "move"; });
  lane.addEventListener("dragleave", ()  => lane.classList.remove("drag-over"));
  lane.addEventListener("drop",      (e) => {
    e.preventDefault();
    lane.classList.remove("drag-over");
    const task = state.tasks.find((t) => t.id === e.dataTransfer.getData("text/plain"));
    if (!task) return;
    updateTaskStatus(task, lane.dataset.lane);
    saveState(); render();
  });
});

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  // If the app's core DOM isn't present (e.g. the login screen is showing),
  // skip rendering entirely to avoid null-element crashes.
  if (!els.seedData || !els.portfolioForm || !els.metricChase) return;
  renderPreviewMode();
  renderSelectors();
  renderMetrics();
  renderPriorityQueue();
  renderDashboard();
  renderPortfolioBoard();
  renderTasks();
  renderPeople();
  renderCalendar();
  renderCompleted();
  renderPeopleSuggestions();
}

function renderPreviewMode() {
  els.seedData.textContent = previewMode ? "Previewing sample data" : "Preview sample data";
  els.seedData.disabled    = previewMode;
}

function renderPreviewDialog() {
  if (!els.previewBoard) return;
  const items = sortedPortfolios().map((portfolio) => {
    const workstreams = state.workstreams.filter((ws) => ws.portfolioId === portfolio.id);
    return `
      <section class="group">
        <div class="group-heading"><h2>${portfolioNameMarkup(portfolio)}</h2></div>
        <div class="board">${workstreams.length
          ? workstreams.map(workstreamGroupMarkup).join("")
          : emptyMarkup("No workstreams yet.", "")
        }</div>
      </section>`;
  });
  els.previewBoard.innerHTML = items.join("") || emptyMarkup("No data.", "");
}

function renderSelectors() {
  renderSelect(els.workstreamPortfolio, state.portfolios, "Create a portfolio first");
  renderSelect(els.taskWorkstream, state.workstreams, "Create a workstream first", workstreamLabel);
  els.workstreamForm.querySelector("button").disabled = state.portfolios.length === 0;
  els.taskForm.querySelector("button").disabled       = state.workstreams.length === 0;
}

function renderSelect(select, items, emptyLabel, labelFn = (item) => item.name) {
  select.innerHTML = "";
  if (items.length === 0) { select.append(new Option(emptyLabel, "")); return; }
  items.slice()
    .sort((a, b) => labelFn(a).localeCompare(labelFn(b)))
    .forEach((item) => select.append(new Option(labelFn(item), item.id)));
}

function renderMetrics() {
  els.metricChase.textContent = state.tasks.filter((t) => t.status === "chased").length;
  els.metricRisk.textContent  = state.tasks.filter((t) => riskLevel(t) === "high").length;
  els.metricBack.textContent  = state.tasks.filter((t) => t.status === "received" || t.status === "with-me").length;
  els.metricHours.textContent = `${state.workstreams.reduce((sum, ws) => sum + Number(ws.effort), 0)}h`;
}

function renderDashboard() {
  // Dashboard has "waiting" and "with-me" lanes per the HTML
  if (els.waitingList) {
    renderCards(els.waitingList, state.tasks.filter((t) => t.status === "waiting" || t.status === "chased").sort(byUrgency));
  }
  if (els.withMeList) {
    renderCards(els.withMeList, state.tasks.filter((t) => t.status === "with-me" || t.status === "received").sort(byUrgency));
  }
}

function renderPriorityQueue() {
  const tasks = state.tasks
    .filter((t) => t.status !== "completed")
    .sort(byPriority)
    .map((t, i) => priorityItemMarkup(t, i + 1));
  renderHtmlOrEmpty(els.priorityList, tasks);
}

function renderPortfolioBoard() {
  const items = sortedPortfolios().map((portfolio) => {
    if (portfolio.editing) return editPortfolioMarkup(portfolio);
    const workstreams = state.workstreams.filter((ws) => ws.portfolioId === portfolio.id);
    return `
      <section class="group">
        <div class="group-heading">
          <h2>${portfolioNameMarkup(portfolio)}</h2>
          <button data-action="edit-portfolio" data-id="${portfolio.id}">Edit</button>
          <button data-action="delete-portfolio" data-id="${portfolio.id}" class="ghost">Delete</button>
        </div>
        <div class="board">${workstreams.length
          ? workstreams.map(workstreamGroupMarkup).join("")
          : emptyMarkup("No workstreams yet.", "Create a workstream and assign it to this portfolio.")
        }</div>
      </section>`;
  });
  renderHtmlOrEmpty(els.portfolioBoard, items);
}

function workstreamGroupMarkup(workstream) {
  if (workstream.editing) return editWorkstreamMarkup(workstream);
  const tasks     = state.tasks.filter((t) => t.workstreamId === workstream.id).sort(byUrgency);
  const completed = tasks.filter((t) => t.status === "completed").length;
  const late      = tasks.filter((t) => t.status !== "completed" && daysUntil(t.dueDate) < 0).length;
  const level     = workstreamRisk(workstream, tasks);
  return `
    <article class="workstream-card risk-${level}">
      <div class="card-title">
        <strong>${escapeHtml(workstream.name)}</strong>
        ${riskPill(level)}
      </div>
      <p class="meta">Deadline ${formatDate(workstream.deadline)}. You still need about ${workstream.effort}h after inputs land.</p>
      <div class="pill-row">
        <span class="pill">${tasks.length} tasks</span>
        <span class="pill amber">${late} overdue</span>
        <span class="pill green">${completed} completed</span>
      </div>
      <div class="actions">
        <button data-action="edit-workstream" data-id="${workstream.id}">Edit</button>
        <button data-action="delete-workstream" data-id="${workstream.id}" class="ghost">Delete</button>
      </div>
      <div class="nested-list">${tasks.length
        ? tasks.map(taskMarkup).join("")
        : emptyMarkup("No tasks yet.", "Create a task under this workstream.")
      }</div>
    </article>`;
}

function renderTasks() {
  renderHtmlOrEmpty(els.taskList, state.tasks.slice().sort(byUrgency).map(taskMarkup));
}

function renderPeople() {
  const people = new Map();
  state.tasks.forEach((task) => {
    task.inputs.forEach((input) => {
      const key = input.name.toLowerCase();
      if (!people.has(key)) people.set(key, { name: input.name, total: 0, open: 0, overdue: 0, chases: 0, tasks: [] });
      const p = people.get(key);
      p.total  += 1;
      p.chases += Number(input.chaseCount || 0);
      if (input.status !== "received" && input.status !== "not-needed") p.open += 1;
      if (input.status !== "received" && input.status !== "not-needed" && daysUntil(task.dueDate) < 0) p.overdue += 1;
      p.tasks.push(task.title);
    });
  });

  const items = [...people.values()]
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name))
    .map((p) => `
      <article class="person-card">
        <div class="card-title">
          <strong>${escapeHtml(p.name)}</strong>
          <span class="pill">${p.open} open</span>
        </div>
        <div class="pill-row">
          <span class="pill amber">${p.overdue} overdue</span>
          <span class="pill">${p.chases} chases</span>
          <span class="pill">${p.total} tasks</span>
        </div>
        <p class="meta">${escapeHtml([...new Set(p.tasks)].slice(0, 3).join(", "))}</p>
      </article>`);
  renderHtmlOrEmpty(els.peopleList, items);
}

function renderCalendar() {
  if (!els.calendarViewer) return;

  // Map every task deadline to its date (include completed, shown muted).
  const byDate = new Map();
  state.tasks.forEach((t) => {
    if (!t.dueDate) return;
    if (!byDate.has(t.dueDate)) byDate.set(t.dueDate, []);
    byDate.get(t.dueDate).push(t);
  });

  const year  = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const monthLabel = calendarMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  // Grid starts on Monday. Compute leading blanks.
  const firstOfMonth = new Date(year, month, 1);
  const jsDay = firstOfMonth.getDay();              // 0=Sun..6=Sat
  const leadingBlanks = (jsDay + 6) % 7;            // convert so Monday=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = today();

  const weekdayHeaders = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    .map((d) => `<div class="cal-weekday">${d}</div>`).join("");

  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(`<div class="cal-cell cal-blank"></div>`);

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayTasks = byDate.get(dateStr) || [];
    const active = dayTasks.filter((t) => t.status !== "completed");
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedCalendarDate;
    const hasOverdue = active.some((t) => daysUntil(t.dueDate) < 0);

    let dots = "";
    if (active.length) {
      const cls = hasOverdue ? "cal-dot overdue" : "cal-dot";
      dots = `<div class="cal-dots"><span class="${cls}"></span>${active.length > 1 ? `<span class="cal-count">${active.length}</span>` : ""}</div>`;
    }

    const classes = ["cal-cell"];
    if (isToday) classes.push("cal-today");
    if (isSelected) classes.push("cal-selected");
    if (active.length) classes.push("cal-has-tasks");

    cells.push(`
      <div class="${classes.join(" ")}" data-cal-date="${dateStr}">
        <span class="cal-daynum">${day}</span>
        ${dots}
      </div>`);
  }

  // Detail list for the selected day (if any tasks).
  let detail = "";
  if (selectedCalendarDate) {
    const dayTasks = (byDate.get(selectedCalendarDate) || []).slice().sort(byUrgency);
    detail = `
      <div class="cal-detail">
        <h3>${formatDate(selectedCalendarDate)}</h3>
        ${dayTasks.length ? dayTasks.map(taskMarkup).join("") : emptyMarkup("No tasks due this day.", "")}
      </div>`;
  }

  els.calendarViewer.innerHTML = `
    <div class="cal-header">
      <button class="ghost" data-cal-nav="prev">‹</button>
      <strong class="cal-month">${monthLabel}</strong>
      <button class="ghost" data-cal-nav="next">›</button>
      <button class="secondary cal-today-btn" data-cal-nav="today">Today</button>
    </div>
    <div class="cal-grid">
      ${weekdayHeaders}
      ${cells.join("")}
    </div>
    ${detail}`;
}

function renderCompleted() {
  if (!els.completedList) return;
  renderCards(els.completedList, state.tasks.filter((t) => t.status === "completed").sort(byCompleted));
}

function renderCards(container, tasks) {
  renderHtmlOrEmpty(container, tasks.map(taskMarkup));
}

function renderPeopleSuggestions(filter = "") {
  if (!els.peopleSuggestions) return;
  const names = new Set();
  state.tasks.forEach((t) => t.inputs.forEach((i) => names.add(i.name)));
  const lower = filter.toLowerCase();
  const relevant = [...names].filter((n) => !filter || n.toLowerCase().includes(lower));
  els.peopleSuggestions.innerHTML = relevant.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

function renderHtmlOrEmpty(container, items) {
  if (!container) return;
  if (!items.length) {
    const tpl = document.querySelector("#empty-state");
    container.innerHTML = tpl ? tpl.innerHTML : "<div class='empty'>Nothing here yet.</div>";
    return;
  }
  container.innerHTML = items.join("");
}

// ─── Markup helpers ───────────────────────────────────────────────────────────

function taskMarkup(task) {
  if (task.editing) return editTaskMarkup(task);
  const workstream = findWorkstream(task.workstreamId);
  const portfolio  = workstream ? findPortfolio(workstream.portfolioId) : null;
  const level      = riskLevel(task);
  const inputCountLabel = task.inputs.length ? `${task.inputs.length} inputs` : "with me";
  return `
    <article class="task-card request-card risk-${level}" draggable="true" data-id="${task.id}">
      <div class="card-title">
        <strong>${escapeHtml(task.title)}</strong>
        ${riskPill(level)}
      </div>
      <p class="meta">${portfolioPathMarkup(portfolio, workstream)} · due ${formatDate(task.dueDate)} · likely ${formatDate(expectedReturn(task))}</p>
      <div class="input-list">
        ${task.inputs.length ? task.inputs.map(inputSummaryMarkup).join("") : noInputsMarkup()}
      </div>
      <div class="pill-row">
        <span class="pill ${statusClass(task.status)}">${labelStatus(task.status)}</span>
        <span class="pill">${priorityLabel(task)}</span>
        <span class="pill">${inputCountLabel}</span>
        <span class="pill">${totalChases(task)} chases</span>
      </div>
      <div class="actions">
        <button data-action="edit-task" data-id="${task.id}">Edit</button>
        <button data-action="waiting"   data-id="${task.id}">Waiting</button>
        ${task.inputs.length ? `<button data-action="chase" data-id="${task.id}">Chased today</button>` : ""}
        <button data-action="receive"  data-id="${task.id}">Inputs received</button>
        <button data-action="complete" data-id="${task.id}">Completed</button>
        <button data-action="delete-task" data-id="${task.id}" class="ghost">Delete</button>
      </div>
    </article>`;
}

function priorityItemMarkup(task, rank) {
  const workstream = findWorkstream(task.workstreamId);
  const portfolio  = workstream ? findPortfolio(workstream.portfolioId) : null;
  return `
    <article class="priority-item risk-${riskLevel(task)}">
      <span class="rank">${rank}</span>
      <div>
        <div class="card-title">
          <strong>${escapeHtml(task.title)}</strong>
          ${riskPill(riskLevel(task))}
        </div>
        <p class="meta">${portfolioPathMarkup(portfolio, workstream)} · task due ${formatDate(task.dueDate)} · workstream due ${formatDate(workstream?.deadline)}</p>
        <p class="meta">${escapeHtml(priorityReason(task))}</p>
      </div>
    </article>`;
}

function inputSummaryMarkup(input) {
  const lastChased = Number(input.chaseCount || 0) > 0 && input.lastChasedAt ? ` · last ${formatDate(input.lastChasedAt)}` : "";
  return `
    <div class="input-row">
      <strong>${escapeHtml(input.name)}</strong>
      <span class="pill ${statusClass(input.status)}">${labelInputStatus(input.status)}</span>
      <span class="meta">${Number(input.chaseCount || 0)} chases${lastChased}</span>
    </div>`;
}

function editTaskMarkup(task) {
  const hasNoInputs = task.inputs.length === 0;
  return `
    <article class="task-card request-card editing" data-id="${task.id}">
      <form class="edit-task-form stack" data-id="${task.id}">
        <label>Workstream
          <select name="workstreamId" required>${workstreamOptionsMarkup(task.workstreamId)}</select>
        </label>
        <label>Task
          <input name="title" required value="${escapeHtml(task.title)}" />
        </label>
        <div class="two-col">
          <label>Due date
            <input name="dueDate" required type="date" value="${escapeHtml(task.dueDate)}" />
          </label>
          <label>Expected delay
            <select name="expectedDelay">${delayOptionsMarkup(task.expectedDelay)}</select>
          </label>
        </div>
        <label>Task status
          <select name="status">${taskStatusOptionsMarkup(task.status)}</select>
        </label>
        <div class="input-edit-list">
          <strong>Inputs needed</strong>
          ${task.inputs.length ? task.inputs.map(inputEditMarkup).join("") : noInputsMarkup()}
        </div>
        <label>Add people/agencies
          <input name="newInputs" placeholder="Optional, comma-separated, e.g. HR, Finance" ${hasNoInputs ? "disabled" : ""} />
        </label>
        <label class="checkbox-row">
          <input name="noInputs" type="checkbox" ${hasNoInputs ? "checked" : ""} />
          <span>No external inputs needed; this task is with me</span>
        </label>
        <div class="actions">
          <button type="submit">Save</button>
          <button type="button" data-action="cancel-task-edit" data-id="${task.id}">Cancel</button>
        </div>
      </form>
    </article>`;
}

function inputEditMarkup(input) {
  const chaseCount = Number(input.chaseCount || 0);
  return `
    <div class="input-edit-row">
      <input type="hidden" name="inputId" value="${input.id}" />
      <label>Name <input name="inputName" required value="${escapeHtml(input.name)}" /></label>
      <label>Status <select name="inputStatus">${inputStatusOptionsMarkup(input.status)}</select></label>
      <label>Chases <input name="inputChaseCount" type="number" min="0" step="1" value="${chaseCount}" /></label>
      <label>Last chase <input name="inputLastChasedAt" type="date" value="${chaseCount > 0 ? escapeHtml(input.lastChasedAt || "") : ""}" /></label>
    </div>`;
}

function editPortfolioMarkup(portfolio) {
  return `
    <section class="group">
      <form class="edit-portfolio-form stack" data-id="${portfolio.id}">
        <label>Portfolio <input name="name" required value="${escapeHtml(portfolio.name)}" /></label>
        <div class="actions">
          <button type="submit">Save</button>
          <button type="button" data-action="cancel-portfolio-edit" data-id="${portfolio.id}">Cancel</button>
        </div>
      </form>
    </section>`;
}

function editWorkstreamMarkup(workstream) {
  return `
    <article class="workstream-card editing">
      <form class="edit-workstream-form stack" data-id="${workstream.id}">
        <label>Portfolio
          <select name="portfolioId" required>${portfolioOptionsMarkup(workstream.portfolioId)}</select>
        </label>
        <label>Workstream <input name="name" required value="${escapeHtml(workstream.name)}" /></label>
        <div class="two-col">
          <label>Deadline <input name="deadline" required type="date" value="${escapeHtml(workstream.deadline)}" /></label>
          <label>Your effort after inputs <select name="effort">${effortOptionsMarkup(workstream.effort)}</select></label>
        </div>
        <div class="actions">
          <button type="submit">Save</button>
          <button type="button" data-action="cancel-workstream-edit" data-id="${workstream.id}">Cancel</button>
        </div>
      </form>
    </article>`;
}

function noInputsMarkup() { return `<p class="meta">No external inputs — task is with me.</p>`; }

function emptyMarkup(heading, sub) {
  return `<div class="empty"><strong>${escapeHtml(heading)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</div>`;
}

function portfolioNameMarkup(portfolio) {
  const color = portfolioColor(portfolio);
  return `<span class="portfolio-dot" style="background:${color}"></span>${escapeHtml(portfolio.name)}`;
}

function portfolioPathMarkup(portfolio, workstream) {
  if (!portfolio && !workstream) return "—";
  const parts = [portfolio?.name, workstream?.name].filter(Boolean);
  return escapeHtml(parts.join(" › "));
}

function riskPill(level) {
  if (level === "high")   return `<span class="pill red">High risk</span>`;
  if (level === "medium") return `<span class="pill amber">Medium risk</span>`;
  return "";
}

function workstreamOptionsMarkup(selectedId) {
  return state.workstreams.map((ws) =>
    `<option value="${ws.id}" ${ws.id === selectedId ? "selected" : ""}>${escapeHtml(workstreamLabel(ws))}</option>`
  ).join("");
}

function portfolioOptionsMarkup(selectedId) {
  return state.portfolios.map((p) =>
    `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`
  ).join("");
}

function taskStatusOptionsMarkup(selected) {
  return TASK_STATUSES.map((s) =>
    `<option value="${s}" ${s === selected ? "selected" : ""}>${labelStatus(s)}</option>`
  ).join("");
}

function inputStatusOptionsMarkup(selected) {
  return INPUT_STATUSES.map((s) =>
    `<option value="${s}" ${s === selected ? "selected" : ""}>${labelInputStatus(s)}</option>`
  ).join("");
}

function delayOptionsMarkup(selected) {
  const opts = [["0","Usually on time"],["1","+1 day"],["2","+2 days"],["5","+1 week-ish"],["30","Chronic late"]];
  return opts.map(([v, l]) => `<option value="${v}" ${Number(v) === Number(selected) ? "selected" : ""}>${l}</option>`).join("");
}

function effortOptionsMarkup(selected) {
  const opts = [["0.5","30 min"],["1","1 hour"],["2","2 hours"],["4","Half day"],["8","Full day"]];
  return opts.map(([v, l]) => `<option value="${v}" ${Number(v) === Number(selected) ? "selected" : ""}>${l}</option>`).join("");
}

// ─── State helpers ────────────────────────────────────────────────────────────

function collectInputs(form) {
  if (form.elements.noInputs?.checked) return [];
  const ids            = form.querySelectorAll("[name='inputId']");
  const names          = form.querySelectorAll("[name='inputName']");
  const statuses       = form.querySelectorAll("[name='inputStatus']");
  const chaseCounts    = form.querySelectorAll("[name='inputChaseCount']");
  const lastChasedDates = form.querySelectorAll("[name='inputLastChasedAt']");
  const inputs = [];
  ids.forEach((field, i) => {
    const name = names[i].value.trim();
    if (!name) return;
    const chaseCount = Math.max(0, Number(chaseCounts[i].value || 0));
    inputs.push({
      id: field.value || crypto.randomUUID(),
      name,
      status: statuses[i].value,
      chaseCount,
      lastChasedAt: chaseCount > 0 ? lastChasedDates[i].value : "",
      receivedAt:   statuses[i].value === "received" ? today() : "",
    });
  });
  return inputs.concat(parseInputNames(form.elements.newInputs.value).map(makeInput));
}

function editEntity(entity) { entity.editing = true; saveState(); render(); }
function cancelEdit(entity) { delete entity.editing; saveState(); render(); }

function deletePortfolio(portfolio) {
  const workstreams = state.workstreams.filter((w) => w.portfolioId === portfolio.id);
  const wsIds = new Set(workstreams.map((w) => w.id));
  const tasks = state.tasks.filter((t) => wsIds.has(t.workstreamId));

  // Ask each time, with detail about what will be removed.
  let message;
  if (workstreams.length === 0) {
    message = `Delete portfolio "${portfolio.name}"?`;
  } else {
    message =
      `Delete portfolio "${portfolio.name}" and everything under it?\n\n` +
      `This will also delete ${workstreams.length} workstream${workstreams.length === 1 ? "" : "s"} ` +
      `and ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`;
  }
  if (!confirm(message)) return;

  state.tasks       = state.tasks.filter((t) => !wsIds.has(t.workstreamId));
  state.workstreams = state.workstreams.filter((w) => w.portfolioId !== portfolio.id);
  state.portfolios  = state.portfolios.filter((p) => p.id !== portfolio.id);
  saveState();
  render();
}

function deleteWorkstream(workstream) {
  const tasks = state.tasks.filter((t) => t.workstreamId === workstream.id);
  let message;
  if (tasks.length === 0) {
    message = `Delete workstream "${workstream.name}"?`;
  } else {
    message =
      `Delete workstream "${workstream.name}" and everything under it?\n\n` +
      `This will also delete ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`;
  }
  if (!confirm(message)) return;

  state.tasks       = state.tasks.filter((t) => t.workstreamId !== workstream.id);
  state.workstreams = state.workstreams.filter((w) => w.id !== workstream.id);
  saveState();
  render();
}

function deleteTask(task) {
  if (!confirm(`Delete task "${task.title}"?`)) return;
  state.tasks = state.tasks.filter((t) => t.id !== task.id);
  saveState();
  render();
}

function updateTaskStatus(task, newStatus) {
  if (newStatus === "chased") {
    task.inputs.forEach((input) => {
      if (input.status !== "received" && input.status !== "not-needed") {
        input.status      = "chased";
        input.chaseCount  = (Number(input.chaseCount) || 0) + 1;
        input.lastChasedAt = today();
      }
    });
  }
  if (newStatus === "received") {
    task.inputs.forEach((input) => {
      if (input.status !== "received") { input.status = "received"; input.receivedAt = today(); }
    });
  }
  task.status = newStatus;
}

function syncNoInputsField() {
  const cb     = els.taskForm.elements.noInputs;
  const inputs = els.taskForm.elements.inputs;
  if (!inputs) return;
  inputs.disabled = cb.checked;
  if (cb.checked) inputs.value = "";
}

function taskDeadlineIsValid(workstreamId, dueDate) {
  const ws = state.workstreams.find((w) => w.id === workstreamId);
  if (!ws) return true;
  if (dueDate > ws.deadline) {
    alert(`Task deadline (${formatDate(dueDate)}) is after the workstream deadline (${formatDate(ws.deadline)}).`);
    return false;
  }
  return true;
}

function setImportStatus(msg) {
  if (!els.importStatus) return;
  els.importStatus.textContent = msg;
  setTimeout(() => { if (els.importStatus) els.importStatus.textContent = ""; }, 5000);
}

// ─── Data / persistence ───────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return structuredClone(defaultState);
}

function saveState() {
  if (previewMode) return;
  // Always keep a local copy as a cache/offline fallback.
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  // If logged in, persist to the cloud too.
  if (window.WorkTrackerCloud) {
    window.WorkTrackerCloud.save(state);
  }
}

function migrateState() {
  state.portfolios  = state.portfolios  || [];
  state.workstreams = state.workstreams || [];
  state.tasks       = state.tasks       || [];
  state.tasks.forEach((task) => {
    task.inputs = task.inputs || [];
    task.inputs.forEach((input) => {
      input.status     = input.status     || "waiting";
      input.chaseCount = input.chaseCount || 0;
    });
    if (!task.status) task.status = "waiting";
  });
}

function mergeImportedState(existing, imported) {
  const existingPortfolioIds  = new Set(existing.portfolios.map((p) => p.id));
  const existingWorkstreamIds = new Set(existing.workstreams.map((w) => w.id));
  const existingTaskIds       = new Set(existing.tasks.map((t) => t.id));
  return {
    portfolios:  [...existing.portfolios,  ...imported.portfolios.filter((p) => !existingPortfolioIds.has(p.id))],
    workstreams: [...existing.workstreams, ...imported.workstreams.filter((w) => !existingWorkstreamIds.has(w.id))],
    tasks:       [...existing.tasks,       ...imported.tasks.filter((t) => !existingTaskIds.has(t.id))],
  };
}

async function readImportFile(file) {
  const text = await file.text();
  if (file.name.endsWith(".json") || file.type === "application/json") {
    const parsed = JSON.parse(text);
    if (parsed.portfolios && parsed.workstreams && parsed.tasks) return parsed;
    throw new Error("JSON file doesn't look like work-tracker data.");
  }
  return parseCsv(text);
}

function parseCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("CSV file appears empty.");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
  });

  const portfolioMap  = new Map();
  const workstreamMap = new Map();
  const taskMap       = new Map();

  rows.forEach((row) => {
    if (row.portfolioId && !portfolioMap.has(row.portfolioId)) {
      portfolioMap.set(row.portfolioId, { id: row.portfolioId, name: row.portfolio || row.portfolioId, createdAt: now() });
    }
    if (row.workstreamId && !workstreamMap.has(row.workstreamId)) {
      workstreamMap.set(row.workstreamId, {
        id: row.workstreamId, portfolioId: row.portfolioId,
        name: row.workstream || row.workstreamId,
        deadline: row.workstreamDeadline || today(),
        effort: Number(row.workstreamEffort) || 1,
        createdAt: now(),
      });
    }
    if (row.taskId && !taskMap.has(row.taskId)) {
      taskMap.set(row.taskId, {
        id: row.taskId, workstreamId: row.workstreamId,
        title: row.task || row.taskId,
        dueDate: row.taskDeadline || today(),
        expectedDelay: Number(row.expectedDelay) || 0,
        status: row.taskStatus || "waiting",
        inputs: [],
        createdAt: now(),
      });
    }
    if (row.taskId && row.inputId) {
      const task = taskMap.get(row.taskId);
      if (task && !task.inputs.find((i) => i.id === row.inputId)) {
        task.inputs.push({
          id: row.inputId, name: row.inputName || row.inputId,
          status: row.inputStatus || "waiting",
          chaseCount: Number(row.chaseCount) || 0,
          lastChasedAt: row.lastChasedAt || "",
          receivedAt: "",
        });
      }
    }
  });

  return {
    portfolios:  [...portfolioMap.values()],
    workstreams: [...workstreamMap.values()],
    tasks:       [...taskMap.values()],
  };
}

function downloadCsv() {
  const rows = [CSV_FIELDS.join(",")];
  state.tasks.forEach((task) => {
    const ws = findWorkstream(task.workstreamId);
    const pf = ws ? findPortfolio(ws.portfolioId) : null;
    const base = [
      pf?.id || "", pf?.name || "",
      ws?.id || "", ws?.name || "",
      ws?.deadline || "", ws?.effort || "",
      task.id, task.title, task.dueDate, task.expectedDelay, task.status,
    ];
    if (task.inputs.length) {
      task.inputs.forEach((input) => {
        rows.push([...base, input.id, input.name, input.status, input.chaseCount, input.lastChasedAt]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","));
      });
    } else {
      rows.push([...base, "", "", "", "", ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
  });

  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: "work-tracker.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sorting & risk ───────────────────────────────────────────────────────────

function byUrgency(a, b) {
  return priorityScore(b) - priorityScore(a);
}

function byPriority(a, b) {
  return priorityScore(b) - priorityScore(a);
}

function byCompleted(a, b) {
  return (b.completedAt || "").localeCompare(a.completedAt || "");
}

function priorityScore(task) {
  const days  = daysUntil(task.dueDate);
  const delay = Number(task.expectedDelay) || 0;
  const ws    = findWorkstream(task.workstreamId);
  const wsDays = ws ? daysUntil(ws.deadline) : 999;
  let score = 0;
  if (days < 0)  score += 100;
  if (days < 3)  score += 50;
  if (days < 7)  score += 20;
  score += Math.max(0, 30 - wsDays);
  score += delay * 2;
  return score;
}

function priorityReason(task) {
  const days = daysUntil(task.dueDate);
  if (days < 0)  return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}.`;
  if (days === 0) return "Due today.";
  if (days <= 3)  return `Due in ${days} day${days === 1 ? "" : "s"}.`;
  const ws = findWorkstream(task.workstreamId);
  if (ws) {
    const wsDays = daysUntil(ws.deadline);
    if (wsDays < 7) return `Workstream deadline in ${wsDays} day${wsDays === 1 ? "" : "s"}.`;
  }
  return `Due ${formatDate(task.dueDate)}.`;
}

function priorityLabel(task) {
  const score = priorityScore(task);
  if (score >= 100) return "🔴 Critical";
  if (score >= 50)  return "🟠 High";
  if (score >= 20)  return "🟡 Medium";
  return "🟢 Low";
}

function riskLevel(task) {
  const days  = daysUntil(task.dueDate);
  const delay = Number(task.expectedDelay) || 0;
  if (days < 0 || days - delay < 0) return "high";
  if (days < 3 || days - delay < 2) return "medium";
  return "low";
}

function workstreamRisk(workstream, tasks) {
  const wsDays = daysUntil(workstream.deadline);
  const effort = Number(workstream.effort) || 0;
  const hasOverdue = tasks.some((t) => t.status !== "completed" && daysUntil(t.dueDate) < 0);
  if (hasOverdue || wsDays - effort < 0) return "high";
  if (wsDays - effort < 2)               return "medium";
  return "low";
}

function expectedReturn(task) {
  const d = new Date(task.dueDate);
  d.setDate(d.getDate() + Number(task.expectedDelay || 0));
  return d.toISOString().slice(0, 10);
}

function totalChases(task) {
  return task.inputs.reduce((sum, i) => sum + Number(i.chaseCount || 0), 0);
}

// ─── Finders ──────────────────────────────────────────────────────────────────

function findWorkstream(id) { return state.workstreams.find((w) => w.id === id); }
function findPortfolio(id)  { return state.portfolios.find((p) => p.id === id); }

function sortedPortfolios() {
  return state.portfolios.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function workstreamLabel(ws) {
  const pf = findPortfolio(ws.portfolioId);
  return pf ? `${pf.name} › ${ws.name}` : ws.name;
}

function portfolioColor(portfolio) {
  const index = state.portfolios.indexOf(portfolio);
  return PORTFOLIO_COLORS[index % PORTFOLIO_COLORS.length];
}

// ─── Data factories ───────────────────────────────────────────────────────────

function makeTask(workstreamId, title, dueDate, expectedDelay, inputsCsv, status) {
  return {
    id: crypto.randomUUID(),
    workstreamId,
    title,
    dueDate,
    expectedDelay,
    status: status || "waiting",
    inputs: parseInputNames(inputsCsv).map(makeInput),
    createdAt: now(),
  };
}

function makeInput(name) {
  return { id: crypto.randomUUID(), name, status: "waiting", chaseCount: 0, lastChasedAt: "", receivedAt: "" };
}

function parseInputNames(csv) {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

// ─── Date utilities ───────────────────────────────────────────────────────────

function now()        { return new Date().toISOString(); }
function today()      { return new Date().toISOString().slice(0, 10); }
function daysUntil(dateStr) {
  if (!dateStr) return 999;
  return Math.round((new Date(dateStr) - new Date(today())) / DAY);
}
function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Label helpers ────────────────────────────────────────────────────────────

function labelStatus(status) {
  return { waiting: "Waiting", chased: "Chased", "with-me": "With me", received: "Received", completed: "Completed" }[status] || status;
}

function labelInputStatus(status) {
  return { waiting: "Waiting", chased: "Chased", received: "Received", "not-needed": "Not needed" }[status] || status;
}

function statusClass(status) {
  return { waiting: "", chased: "amber", "with-me": "blue", received: "green", completed: "green", "not-needed": "" }[status] || "";
}

// ─── Escape ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

})();

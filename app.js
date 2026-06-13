const STORAGE_KEY = "work-tracker-v2";
const LEGACY_STORAGE_KEY = "reply-radar-v1";
const DAY = 24 * 60 * 60 * 1000;
const TASK_STATUSES = ["waiting", "chased", "received", "completed"];
const INPUT_STATUSES = ["waiting", "chased", "received", "not-needed"];
const PORTFOLIO_COLORS = ["#1f6f5b", "#7c3aed", "#b45309", "#0f766e", "#be123c", "#2563eb", "#64748b"];

const defaultState = {
  portfolios: [],
  workstreams: [],
  tasks: [],
};

const sampleState = {
  portfolios: [
    { id: "pf-corporate", name: "Corporate", createdAt: now() },
    { id: "pf-finance", name: "Finance", createdAt: now() },
  ],
  workstreams: [
    {
      id: "ws-planning",
      portfolioId: "pf-corporate",
      name: "Quarterly planning",
      deadline: offsetDate(8),
      effort: 4,
      createdAt: now(),
    },
    {
      id: "ws-budget",
      portfolioId: "pf-finance",
      name: "Budget review",
      deadline: offsetDate(3),
      effort: 2,
      createdAt: now(),
    },
  ],
  tasks: [
    makeTask(
      "ws-planning",
      "Draft briefing note",
      offsetDate(2),
      1,
      "HR, Finance",
      "chased",
    ),
    makeTask("ws-planning", "Review timeline assumptions", offsetDate(5), 2, "", "received"),
    makeTask("ws-budget", "Consolidate headcount assumptions", offsetDate(0), 0, "HR, Finance", "received"),
    makeTask("ws-budget", "Send final clearance note", offsetDate(-2), 0, "", "completed"),
  ],
};

let state = loadState();
let pointerDragTaskId = "";

const els = {
  seedData: document.querySelector("#seed-data"),
  clearData: document.querySelector("#clear-data"),
  portfolioForm: document.querySelector("#portfolio-form"),
  workstreamForm: document.querySelector("#workstream-form"),
  taskForm: document.querySelector("#task-form"),
  workstreamPortfolio: document.querySelector("#workstream-portfolio"),
  taskWorkstream: document.querySelector("#task-workstream"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  chaseList: document.querySelector("#chase-list"),
  priorityList: document.querySelector("#priority-list"),
  waitingList: document.querySelector("#waiting-list"),
  backList: document.querySelector("#back-list"),
  completedList: document.querySelector("#completed-list"),
  portfolioBoard: document.querySelector("#portfolio-board"),
  taskList: document.querySelector("#task-list"),
  peopleList: document.querySelector("#people-list"),
  metricChase: document.querySelector("#metric-chase"),
  metricRisk: document.querySelector("#metric-risk"),
  metricBack: document.querySelector("#metric-back"),
  metricHours: document.querySelector("#metric-hours"),
};

migrateState();
render();

els.seedData.addEventListener("click", () => {
  state = structuredClone(sampleState);
  saveState();
  render();
});

els.clearData.addEventListener("click", () => {
  if (!confirm("Reset all locally saved tracker data?")) return;
  state = structuredClone(defaultState);
  saveState();
  render();
});

els.portfolioForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state.portfolios.push({
    id: crypto.randomUUID(),
    name: data.name.trim(),
    createdAt: now(),
  });
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
  state.tasks.push(makeTask(data.workstreamId, data.title, data.dueDate, Number(data.expectedDelay), data.noInputs ? "" : data.inputs, data.status));
  event.currentTarget.reset();
  syncNoInputsField();
  saveState();
  render();
});

els.taskForm.elements.noInputs.addEventListener("change", syncNoInputsField);

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    els.tabs.forEach((item) => item.classList.remove("active"));
    els.views.forEach((view) => view.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.view}-view`).classList.add("active");
  });
});

document.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  const id = event.target.dataset.id;
  if (!action || !id) return;

  const portfolio = state.portfolios.find((item) => item.id === id);
  if (portfolio && action === "edit-portfolio") return editEntity(portfolio);
  if (portfolio && action === "cancel-portfolio-edit") return cancelEdit(portfolio);

  const workstream = state.workstreams.find((item) => item.id === id);
  if (workstream && action === "edit-workstream") return editEntity(workstream);
  if (workstream && action === "cancel-workstream-edit") return cancelEdit(workstream);

  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  if (action === "edit-task") return editEntity(task);
  if (action === "cancel-task-edit") return cancelEdit(task);
  if (action === "waiting") updateTaskStatus(task, "waiting");
  if (action === "chase") updateTaskStatus(task, "chased");
  if (action === "receive") updateTaskStatus(task, "received");
  if (action === "complete") updateTaskStatus(task, "completed");
  saveState();
  render();
});

document.addEventListener("submit", (event) => {
  if (event.target.matches(".edit-portfolio-form")) {
    event.preventDefault();
    const portfolio = state.portfolios.find((item) => item.id === event.target.dataset.id);
    const data = Object.fromEntries(new FormData(event.target));
    portfolio.name = data.name.trim();
    delete portfolio.editing;
    saveState();
    render();
    return;
  }

  if (event.target.matches(".edit-workstream-form")) {
    event.preventDefault();
    const workstream = state.workstreams.find((item) => item.id === event.target.dataset.id);
    const data = Object.fromEntries(new FormData(event.target));
    workstream.portfolioId = data.portfolioId;
    workstream.name = data.name.trim();
    workstream.deadline = data.deadline;
    workstream.effort = Number(data.effort);
    delete workstream.editing;
    saveState();
    render();
    return;
  }

  if (event.target.matches(".edit-task-form")) {
    event.preventDefault();
    const task = state.tasks.find((item) => item.id === event.target.dataset.id);
    const data = Object.fromEntries(new FormData(event.target));
    if (!taskDeadlineIsValid(data.workstreamId, data.dueDate)) return;
    task.workstreamId = data.workstreamId;
    task.title = data.title.trim();
    task.dueDate = data.dueDate;
    task.expectedDelay = Number(data.expectedDelay);
    updateTaskStatus(task, data.status);
    task.inputs = collectInputs(event.target);
    delete task.editing;
    saveState();
    render();
  }
});

document.addEventListener("change", (event) => {
  if (!event.target.matches(".edit-task-form [name='noInputs']")) return;
  const form = event.target.closest(".edit-task-form");
  const newInputs = form.elements.newInputs;
  newInputs.disabled = event.target.checked;
  if (event.target.checked) newInputs.value = "";
});

document.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".task-card");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.id);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
});

document.addEventListener("dragend", (event) => {
  event.target.closest(".task-card")?.classList.remove("dragging");
  document.querySelectorAll(".lane.drag-over").forEach((lane) => lane.classList.remove("drag-over"));
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
  document.querySelectorAll(".task-card.dragging").forEach((card) => card.classList.remove("dragging"));
  if (!lane) {
    pointerDragTaskId = "";
    return;
  }
  const task = state.tasks.find((item) => item.id === pointerDragTaskId);
  pointerDragTaskId = "";
  if (!task) return;
  updateTaskStatus(task, lane.dataset.lane);
  saveState();
  render();
});

document.querySelectorAll(".lane[data-lane]").forEach((lane) => {
  lane.addEventListener("dragover", (event) => {
    event.preventDefault();
    lane.classList.add("drag-over");
    event.dataTransfer.dropEffect = "move";
  });

  lane.addEventListener("dragleave", () => lane.classList.remove("drag-over"));

  lane.addEventListener("drop", (event) => {
    event.preventDefault();
    lane.classList.remove("drag-over");
    const task = state.tasks.find((item) => item.id === event.dataTransfer.getData("text/plain"));
    if (!task) return;
    updateTaskStatus(task, lane.dataset.lane);
    saveState();
    render();
  });
});

function render() {
  renderSelectors();
  renderMetrics();
  renderPriorityQueue();
  renderToday();
  renderPortfolioBoard();
  renderTasks();
  renderPeople();
}

function renderSelectors() {
  renderSelect(els.workstreamPortfolio, state.portfolios, "Create a portfolio first");
  renderSelect(els.taskWorkstream, state.workstreams, "Create a workstream first", workstreamLabel);
  els.workstreamForm.querySelector("button").disabled = state.portfolios.length === 0;
  els.taskForm.querySelector("button").disabled = state.workstreams.length === 0;
}

function renderSelect(select, items, emptyLabel, labelFn = (item) => item.name) {
  select.innerHTML = "";
  if (items.length === 0) {
    select.append(new Option(emptyLabel, ""));
    return;
  }
  items
    .slice()
    .sort((a, b) => labelFn(a).localeCompare(labelFn(b)))
    .forEach((item) => select.append(new Option(labelFn(item), item.id)));
}

function renderMetrics() {
  els.metricChase.textContent = state.tasks.filter((task) => task.status === "chased").length;
  els.metricRisk.textContent = state.tasks.filter((task) => riskLevel(task) === "high").length;
  els.metricBack.textContent = state.tasks.filter((task) => task.status === "received").length;
  els.metricHours.textContent = `${state.workstreams.reduce((total, item) => total + Number(item.effort), 0)}h`;
}

function renderToday() {
  renderCards(els.chaseList, state.tasks.filter((task) => task.status === "chased").sort(byUrgency));
  renderCards(els.waitingList, state.tasks.filter((task) => task.status === "waiting").sort(byUrgency));
  renderCards(els.backList, state.tasks.filter((task) => task.status === "received").sort(byUrgency));
  renderCards(els.completedList, state.tasks.filter((task) => task.status === "completed").sort(byCompleted));
}

function renderPriorityQueue() {
  const tasks = state.tasks
    .filter((task) => task.status !== "completed")
    .sort(byPriority)
    .map((task, index) => priorityItemMarkup(task, index + 1));
  renderHtmlOrEmpty(els.priorityList, tasks);
}

function renderPortfolioBoard() {
  const items = sortedPortfolios().map((portfolio) => {
    if (portfolio.editing) return editPortfolioMarkup(portfolio);
    const workstreams = state.workstreams.filter((workstream) => workstream.portfolioId === portfolio.id);
    return `
      <section class="group">
        <div class="group-heading">
          <h2>${portfolioNameMarkup(portfolio)}</h2>
          <button data-action="edit-portfolio" data-id="${portfolio.id}">Edit</button>
        </div>
        <div class="board">
          ${
            workstreams.length
              ? workstreams.map(workstreamGroupMarkup).join("")
              : emptyMarkup("No workstreams yet.", "Create a workstream and assign it to this portfolio.")
          }
        </div>
      </section>
    `;
  });
  renderHtmlOrEmpty(els.portfolioBoard, items);
}

function workstreamGroupMarkup(workstream) {
  if (workstream.editing) return editWorkstreamMarkup(workstream);
  const tasks = state.tasks.filter((task) => task.workstreamId === workstream.id).sort(byUrgency);
  const completed = tasks.filter((task) => task.status === "completed").length;
  const late = tasks.filter((task) => task.status !== "completed" && daysUntil(task.dueDate) < 0).length;
  const level = workstreamRisk(workstream, tasks);
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
      </div>
      <div class="nested-list">
        ${
          tasks.length
            ? tasks.map(taskMarkup).join("")
            : emptyMarkup("No tasks yet.", "Create a task under this workstream.")
        }
      </div>
    </article>
  `;
}

function renderTasks() {
  renderHtmlOrEmpty(els.taskList, state.tasks.slice().sort(byUrgency).map(taskMarkup));
}

function renderPeople() {
  const people = new Map();
  state.tasks.forEach((task) => {
    task.inputs.forEach((input) => {
      const key = input.name.toLowerCase();
      if (!people.has(key)) {
        people.set(key, { name: input.name, total: 0, open: 0, overdue: 0, chases: 0, tasks: [] });
      }
      const person = people.get(key);
      person.total += 1;
      person.chases += Number(input.chaseCount || 0);
      if (input.status !== "received" && input.status !== "not-needed") person.open += 1;
      if (input.status !== "received" && input.status !== "not-needed" && daysUntil(task.dueDate) < 0) person.overdue += 1;
      person.tasks.push(task.title);
    });
  });

  const items = [...people.values()]
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name))
    .map((person) => `
      <article class="person-card">
        <div class="card-title">
          <strong>${escapeHtml(person.name)}</strong>
          <span class="pill">${person.open} open</span>
        </div>
        <div class="pill-row">
          <span class="pill amber">${person.overdue} overdue</span>
          <span class="pill">${person.chases} chases</span>
          <span class="pill">${person.total} tasks</span>
        </div>
        <p class="meta">${escapeHtml([...new Set(person.tasks)].slice(0, 3).join(", "))}</p>
      </article>
    `);
  renderHtmlOrEmpty(els.peopleList, items);
}

function renderCards(container, tasks) {
  renderHtmlOrEmpty(container, tasks.map(taskMarkup));
}

function taskMarkup(task) {
  if (task.editing) return editTaskMarkup(task);
  const workstream = findWorkstream(task.workstreamId);
  const portfolio = workstream ? findPortfolio(workstream.portfolioId) : null;
  const level = riskLevel(task);
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
        <button data-action="waiting" data-id="${task.id}">Waiting</button>
        ${task.inputs.length ? `<button data-action="chase" data-id="${task.id}">Chased today</button>` : ""}
        <button data-action="receive" data-id="${task.id}">Received</button>
        <button data-action="complete" data-id="${task.id}">Completed</button>
      </div>
    </article>
  `;
}

function priorityItemMarkup(task, rank) {
  const workstream = findWorkstream(task.workstreamId);
  const portfolio = workstream ? findPortfolio(workstream.portfolioId) : null;
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
    </article>
  `;
}

function inputSummaryMarkup(input) {
  const lastChased = Number(input.chaseCount || 0) > 0 && input.lastChasedAt ? ` · last ${formatDate(input.lastChasedAt)}` : "";
  return `
    <div class="input-row">
      <strong>${escapeHtml(input.name)}</strong>
      <span class="pill ${statusClass(input.status)}">${labelInputStatus(input.status)}</span>
      <span class="meta">${Number(input.chaseCount || 0)} chases${lastChased}</span>
    </div>
  `;
}

function editTaskMarkup(task) {
  const hasNoInputs = task.inputs.length === 0;
  return `
    <article class="task-card request-card editing" data-id="${task.id}">
      <form class="edit-task-form stack" data-id="${task.id}">
        <label>
          Workstream
          <select name="workstreamId" required>${workstreamOptionsMarkup(task.workstreamId)}</select>
        </label>
        <label>
          Task
          <input name="title" required value="${escapeHtml(task.title)}" />
        </label>
        <div class="two-col">
          <label>
            Due date
            <input name="dueDate" required type="date" value="${escapeHtml(task.dueDate)}" />
          </label>
          <label>
            Expected delay
            <select name="expectedDelay">${delayOptionsMarkup(task.expectedDelay)}</select>
          </label>
        </div>
        <label>
          Task status
          <select name="status">${taskStatusOptionsMarkup(task.status)}</select>
        </label>
        <div class="input-edit-list">
          <strong>Inputs needed</strong>
          ${task.inputs.length ? task.inputs.map(inputEditMarkup).join("") : noInputsMarkup()}
        </div>
        <label>
          Add people/agencies
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
    </article>
  `;
}

function inputEditMarkup(input) {
  const chaseCount = Number(input.chaseCount || 0);
  return `
    <div class="input-edit-row">
      <input type="hidden" name="inputId" value="${input.id}" />
      <label>
        Name
        <input name="inputName" required value="${escapeHtml(input.name)}" />
      </label>
      <label>
        Status
        <select name="inputStatus">${inputStatusOptionsMarkup(input.status)}</select>
      </label>
      <label>
        Chases
        <input name="inputChaseCount" type="number" min="0" step="1" value="${chaseCount}" />
      </label>
      <label>
        Last chase
        <input name="inputLastChasedAt" type="date" value="${chaseCount > 0 ? escapeHtml(input.lastChasedAt || "") : ""}" />
      </label>
    </div>
  `;
}

function editPortfolioMarkup(portfolio) {
  return `
    <section class="group">
      <form class="edit-portfolio-form stack" data-id="${portfolio.id}">
        <label>
          Portfolio
          <input name="name" required value="${escapeHtml(portfolio.name)}" />
        </label>
        <div class="actions">
          <button type="submit">Save</button>
          <button type="button" data-action="cancel-portfolio-edit" data-id="${portfolio.id}">Cancel</button>
        </div>
      </form>
    </section>
  `;
}

function editWorkstreamMarkup(workstream) {
  return `
    <article class="workstream-card editing">
      <form class="edit-workstream-form stack" data-id="${workstream.id}">
        <label>
          Portfolio
          <select name="portfolioId" required>${portfolioOptionsMarkup(workstream.portfolioId)}</select>
        </label>
        <label>
          Workstream
          <input name="name" required value="${escapeHtml(workstream.name)}" />
        </label>
        <div class="two-col">
          <label>
            Deadline
            <input name="deadline" required type="date" value="${escapeHtml(workstream.deadline)}" />
          </label>
          <label>
            Your effort after inputs
            <select name="effort">${effortOptionsMarkup(workstream.effort)}</select>
          </label>
        </div>
        <div class="actions">
          <button type="submit">Save</button>
          <button type="button" data-action="cancel-workstream-edit" data-id="${workstream.id}">Cancel</button>
        </div>
      </form>
    </article>
  `;
}

function collectInputs(form) {
  if (form.elements.noInputs?.checked) return [];

  const ids = form.querySelectorAll("[name='inputId']");
  const names = form.querySelectorAll("[name='inputName']");
  const statuses = form.querySelectorAll("[name='inputStatus']");
  const chaseCounts = form.querySelectorAll("[name='inputChaseCount']");
  const lastChasedDates = form.querySelectorAll("[name='inputLastChasedAt']");
  const inputs = [];

  ids.forEach((field, index) => {
    const name = names[index].value.trim();
    if (!name) return;
    const chaseCount = Math.max(0, Number(chaseCounts[index].value || 0));
    inputs.push({
      id: field.value || crypto.randomUUID(),
      name,
      status: statuses[index].value,
      chaseCount,
      lastChasedAt: chaseCount > 0 ? lastChasedDates[index].value : "",
      receivedAt: statuses[index].value === "received" ? today() : "",
    });
  });

  return inputs.concat(parseInputNames(form.elements.newInputs.value).map((name) => makeInput(name)));
}

function editEntity(entity) {
  entity.editing = true;
  saveState();
  render();
}

function cancelEdit(entity) {
  delete entity.editing;
  saveState();
  render();
}

function updateTaskStatus(task, status) {
  const previousStatus = task.status;
  if (status === "chased" && task.inputs.length === 0) status = "received";
  task.status = status;
  if (status === "chased" && previousStatus !== "chased") {
    task.inputs
      .filter((input) => input.status === "waiting" || input.status === "chased")
      .forEach((input) => {
        input.status = "chased";
        input.chaseCount = Number(input.chaseCount || 0) + 1;
        input.lastChasedAt = today();
      });
  }
  if (status === "received") {
    if (!task.receivedAt) task.receivedAt = today();
    task.inputs
      .filter((input) => input.status === "waiting" || input.status === "chased")
      .forEach((input) => {
        input.status = "received";
        input.receivedAt = today();
      });
  }
  if (status === "completed" && !task.completedAt) task.completedAt = today();
}

function taskDeadlineIsValid(workstreamId, taskDeadline) {
  const workstream = findWorkstream(workstreamId);
  if (!workstream || dateValue(taskDeadline) <= dateValue(workstream.deadline)) return true;
  alert(`Task deadline must be on or before the workstream deadline (${formatDate(workstream.deadline)}).`);
  return false;
}

function makeTask(workstreamId, title, dueDate, expectedDelay, inputs, status = "waiting") {
  const parsedInputs = parseInputNames(inputs);
  const effectiveStatus = parsedInputs.length === 0 && (status === "waiting" || status === "chased") ? "received" : status;
  return {
    id: crypto.randomUUID(),
    workstreamId,
    title: title.trim(),
    dueDate,
    expectedDelay: Number(expectedDelay),
    status: effectiveStatus,
    requestedAt: today(),
    receivedAt: effectiveStatus === "received" ? today() : "",
    completedAt: effectiveStatus === "completed" ? today() : "",
    inputs: parsedInputs.map((name) => makeInput(name, effectiveStatus === "chased" ? "chased" : "waiting")),
  };
}

function makeInput(name, status = "waiting") {
  return {
    id: crypto.randomUUID(),
    name,
    status,
    chaseCount: status === "chased" ? 1 : 0,
    lastChasedAt: status === "chased" ? today() : "",
    receivedAt: status === "received" ? today() : "",
  };
}

function parseInputNames(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function migrateState() {
  state.portfolios ||= [];
  state.workstreams ||= [];
  state.tasks ||= [];
  state.portfolios.forEach((portfolio) => delete portfolio.editing);
  state.workstreams.forEach((workstream) => delete workstream.editing);
  state.tasks.forEach((task) => {
    delete task.editing;
    if (!TASK_STATUSES.includes(task.status)) task.status = "chased";
    task.completedAt ||= "";
    task.receivedAt ||= "";
    task.inputs ||= [];
    task.inputs.forEach((input) => {
      if (!INPUT_STATUSES.includes(input.status)) input.status = "waiting";
      input.chaseCount = Number(input.chaseCount || 0);
      input.lastChasedAt ||= "";
      if (input.chaseCount === 0) input.lastChasedAt = "";
      input.receivedAt ||= "";
    });
  });
  saveState();
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return migrateLegacyState(JSON.parse(legacy));
  } catch {
    return structuredClone(defaultState);
  }
  return structuredClone(defaultState);
}

function migrateLegacyState(legacy) {
  const portfolio = { id: "pf-migrated", name: "Migrated work", createdAt: now() };
  const workstreams = (legacy.workstreams || []).map((workstream) => ({
    id: workstream.id,
    portfolioId: portfolio.id,
    name: workstream.name,
    deadline: workstream.deadline,
    effort: workstream.effort,
    createdAt: workstream.createdAt || now(),
  }));
  const tasks = (legacy.requests || []).map((request) => ({
    id: request.id,
    workstreamId: request.workstreamId,
    title: request.inputNeeded,
    dueDate: request.dueDate,
    expectedDelay: Number(request.expectedDelay || 0),
    status: request.status === "completed" ? "completed" : request.status === "received" ? "received" : request.status === "chased" ? "chased" : "waiting",
    requestedAt: request.requestedAt || today(),
    receivedAt: request.receivedAt || "",
    completedAt: request.completedAt || "",
    inputs: request.person ? [makeInput(request.person, request.status === "chased" ? "chased" : "waiting")] : [],
  }));
  return { portfolios: [portfolio], workstreams, tasks };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function renderHtmlOrEmpty(container, items) {
  container.innerHTML = items.length ? items.join("") : document.querySelector("#empty-state").innerHTML;
}

function emptyMarkup(title, body) {
  return `<div class="empty"><strong>${title}</strong><span>${body}</span></div>`;
}

function findPortfolio(id) {
  return state.portfolios.find((portfolio) => portfolio.id === id);
}

function findWorkstream(id) {
  return state.workstreams.find((workstream) => workstream.id === id);
}

function workstreamLabel(workstream) {
  const portfolio = findPortfolio(workstream.portfolioId);
  return `${portfolio?.name || "No portfolio"} > ${workstream.name}`;
}

function sortedPortfolios() {
  return state.portfolios.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function byUrgency(a, b) {
  const score = { high: 3, medium: 2, low: 1 };
  return score[riskLevel(b)] - score[riskLevel(a)] || dateValue(a.dueDate) - dateValue(b.dueDate);
}

function byPriority(a, b) {
  return priorityScore(b) - priorityScore(a) || dateValue(a.dueDate) - dateValue(b.dueDate);
}

function byCompleted(a, b) {
  return dateValue(b.completedAt) - dateValue(a.completedAt);
}

function workstreamRisk(workstream, tasks) {
  if (tasks.some((task) => riskLevel(task) === "high")) return "high";
  if (daysUntil(workstream.deadline) <= Math.ceil(Number(workstream.effort) / 2) + 1) return "high";
  if (tasks.some((task) => riskLevel(task) === "medium")) return "medium";
  if (daysUntil(workstream.deadline) <= 5) return "medium";
  return "low";
}

function riskLevel(task) {
  if (task.status === "received" || task.status === "completed") return "low";
  const workstream = findWorkstream(task.workstreamId);
  const overdue = daysUntil(task.dueDate) < 0;
  const finalSoon = workstream ? daysUntil(workstream.deadline) <= Math.ceil(Number(workstream.effort) / 2) + 1 : false;
  const expectedAfterDeadline = workstream ? dateValue(expectedReturn(task)) > dateValue(workstream.deadline) : false;
  if ((overdue && finalSoon) || expectedAfterDeadline) return "high";
  if (overdue || finalSoon || task.status === "chased" || task.inputs.some((input) => input.status === "chased")) return "medium";
  return "low";
}

function priorityScore(task) {
  const workstream = findWorkstream(task.workstreamId);
  let score = 0;
  const taskDays = daysUntil(task.dueDate);
  const workstreamDays = workstream ? daysUntil(workstream.deadline) : 99;

  if (task.status === "received") score += 35;
  if (task.status === "chased") score += 24;
  if (taskDays < 0) score += 45;
  else if (taskDays === 0) score += 36;
  else if (taskDays <= 2) score += 28;
  else if (taskDays <= 5) score += 16;
  if (workstreamDays <= 2) score += 24;
  else if (workstreamDays <= 5) score += 16;
  if (workstream && dateValue(expectedReturn(task)) > dateValue(workstream.deadline)) score += 30;
  score += Math.min(totalChases(task) * 4, 20);
  score += task.inputs.filter((input) => input.status === "waiting" || input.status === "chased").length * 3;
  if (task.inputs.length === 0 && task.status === "received") score += 12;
  return score;
}

function priorityLabel(task) {
  const score = priorityScore(task);
  if (score >= 70) return "Do first";
  if (score >= 45) return "High priority";
  if (score >= 25) return "Medium priority";
  return "Low priority";
}

function priorityReason(task) {
  const workstream = findWorkstream(task.workstreamId);
  const reasons = [];
  const taskDays = daysUntil(task.dueDate);
  if (task.status === "received") reasons.push("back with you");
  if (task.status === "chased") reasons.push("already being chased");
  if (taskDays < 0) reasons.push(`${Math.abs(taskDays)}d overdue`);
  else if (taskDays === 0) reasons.push("due today");
  else reasons.push(`due in ${taskDays}d`);
  if (workstream) {
    const workstreamDays = daysUntil(workstream.deadline);
    reasons.push(`workstream due in ${workstreamDays}d`);
    if (dateValue(expectedReturn(task)) > dateValue(workstream.deadline)) reasons.push("likely return is after final deadline");
  }
  const openInputs = task.inputs.filter((input) => input.status === "waiting" || input.status === "chased").length;
  if (openInputs) reasons.push(`${openInputs} inputs still open`);
  if (totalChases(task)) reasons.push(`${totalChases(task)} chases`);
  return reasons.join(" · ");
}

function expectedReturn(task) {
  return addDays(task.dueDate, Number(task.expectedDelay || 0));
}

function totalChases(task) {
  return task.inputs.reduce((total, input) => total + Number(input.chaseCount || 0), 0);
}

function noInputsMarkup() {
  return `<div class="input-row muted-row"><strong>With me</strong><span class="meta">No external inputs needed</span></div>`;
}

function riskPill(level) {
  const label = level === "high" ? "At risk" : level === "medium" ? "Watch" : "Stable";
  const color = level === "high" ? "red" : level === "medium" ? "amber" : "green";
  return `<span class="pill ${color}">${label}</span>`;
}

function statusClass(status) {
  if (status === "chased") return "amber";
  if (status === "received" || status === "completed" || status === "not-needed") return "green";
  return "";
}

function labelStatus(status) {
  return {
    waiting: "Waiting",
    chased: "Chased",
    received: "Back with me",
    completed: "Completed",
  }[status];
}

function labelInputStatus(status) {
  return {
    waiting: "Waiting",
    chased: "Chased",
    received: "Received",
    "not-needed": "Not needed",
  }[status];
}

function portfolioOptionsMarkup(selectedId) {
  return sortedPortfolios()
    .map((portfolio) => `<option value="${portfolio.id}" ${portfolio.id === selectedId ? "selected" : ""}>${escapeHtml(portfolio.name)}</option>`)
    .join("");
}

function portfolioPathMarkup(portfolio, workstream) {
  const portfolioName = portfolio?.name || "No portfolio";
  return `${portfolio ? portfolioDotMarkup(portfolio) : ""}${escapeHtml(portfolioName)} > ${escapeHtml(workstream?.name || "No workstream")}`;
}

function portfolioNameMarkup(portfolio) {
  return `${portfolioDotMarkup(portfolio)}${escapeHtml(portfolio.name)}`;
}

function portfolioDotMarkup(portfolio) {
  return `<span class="portfolio-dot" style="--portfolio-color: ${portfolioColor(portfolio)}"></span>`;
}

function portfolioColor(portfolio) {
  const key = `${portfolio?.id || ""}${portfolio?.name || ""}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash + key.charCodeAt(index) * (index + 1)) % PORTFOLIO_COLORS.length;
  return PORTFOLIO_COLORS[hash];
}

function syncNoInputsField() {
  const noInputs = els.taskForm.elements.noInputs.checked;
  els.taskForm.elements.inputs.disabled = noInputs;
  if (noInputs) els.taskForm.elements.inputs.value = "";
}

function workstreamOptionsMarkup(selectedId) {
  return state.workstreams
    .slice()
    .sort((a, b) => workstreamLabel(a).localeCompare(workstreamLabel(b)))
    .map((workstream) => `<option value="${workstream.id}" ${workstream.id === selectedId ? "selected" : ""}>${escapeHtml(workstreamLabel(workstream))}</option>`)
    .join("");
}

function taskStatusOptionsMarkup(selectedStatus) {
  return TASK_STATUSES.map((status) => `<option value="${status}" ${status === selectedStatus ? "selected" : ""}>${labelStatus(status)}</option>`).join("");
}

function inputStatusOptionsMarkup(selectedStatus) {
  return INPUT_STATUSES.map((status) => `<option value="${status}" ${status === selectedStatus ? "selected" : ""}>${labelInputStatus(status)}</option>`).join("");
}

function delayOptionsMarkup(selectedDelay) {
  return [
    [0, "Usually on time"],
    [1, "+1 day"],
    [2, "+2 days"],
    [5, "+1 week-ish"],
    [30, "Chronic late"],
  ]
    .map(([value, label]) => `<option value="${value}" ${Number(selectedDelay) === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function effortOptionsMarkup(selectedEffort) {
  return [
    [0.5, "30 min"],
    [1, "1 hour"],
    [2, "2 hours"],
    [4, "Half day"],
    [8, "Full day"],
  ]
    .map(([value, label]) => `<option value="${value}" ${Number(selectedEffort) === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function now() {
  return new Date().toISOString();
}

function today() {
  return toDateInputValue(new Date());
}

function offsetDate(days) {
  return addDays(today(), days);
}

function addDays(date, days) {
  const next = parseDateInputValue(date);
  next.setDate(next.getDate() + Number(days));
  return toDateInputValue(next);
}

function daysUntil(date) {
  return Math.ceil((dateValue(date) - dateValue(today())) / DAY);
}

function dateValue(date) {
  if (!date) return Number.POSITIVE_INFINITY;
  return parseDateInputValue(date).getTime();
}

function formatDate(date) {
  if (!date) return "not set";
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
  }).format(parseDateInputValue(date));
}

function parseDateInputValue(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

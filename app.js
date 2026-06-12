const STORAGE_KEY = "reply-radar-v1";
const DAY = 24 * 60 * 60 * 1000;

const defaultState = {
  workstreams: [],
  requests: [],
};

const sampleState = {
  workstreams: [
    {
      id: "ws-board",
      name: "Q3 board deck",
      deadline: offsetDate(5),
      effort: 4,
      createdAt: new Date().toISOString(),
    },
    {
      id: "ws-policy",
      name: "Policy review",
      deadline: offsetDate(12),
      effort: 2,
      createdAt: new Date().toISOString(),
    },
    {
      id: "ws-budget",
      name: "Budget paper",
      deadline: offsetDate(2),
      effort: 3,
      createdAt: new Date().toISOString(),
    },
  ],
  requests: [
    makeRequest("ws-board", "Jaryl", "Confirm narrative for risks slide", -3, 2, "waiting"),
    makeRequest("ws-board", "Finance", "Latest revenue figures", 0, 1, "chased"),
    makeRequest("ws-policy", "Legal", "Comments on revised clause", 3, 2, "waiting"),
    makeRequest("ws-budget", "Ops", "Headcount assumptions", -1, 0, "blocked"),
    makeRequest("ws-budget", "HR", "Promotion cycle numbers", -2, 1, "received"),
  ],
};

let state = loadState();

const els = {
  seedData: document.querySelector("#seed-data"),
  clearData: document.querySelector("#clear-data"),
  workstreamForm: document.querySelector("#workstream-form"),
  requestForm: document.querySelector("#request-form"),
  requestWorkstream: document.querySelector("#request-workstream"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  chaseList: document.querySelector("#chase-list"),
  expectedList: document.querySelector("#expected-list"),
  backList: document.querySelector("#back-list"),
  workstreamBoard: document.querySelector("#workstream-board"),
  requestList: document.querySelector("#request-list"),
  peopleList: document.querySelector("#people-list"),
  metricChase: document.querySelector("#metric-chase"),
  metricRisk: document.querySelector("#metric-risk"),
  metricBack: document.querySelector("#metric-back"),
  metricHours: document.querySelector("#metric-hours"),
};

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

els.workstreamForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state.workstreams.push({
    id: crypto.randomUUID(),
    name: data.name.trim(),
    deadline: data.deadline,
    effort: Number(data.effort),
    createdAt: new Date().toISOString(),
  });
  event.currentTarget.reset();
  saveState();
  render();
});

els.requestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state.requests.push({
    id: crypto.randomUUID(),
    workstreamId: data.workstreamId,
    person: data.person.trim(),
    inputNeeded: data.inputNeeded.trim(),
    dueDate: data.dueDate,
    expectedDelay: Number(data.expectedDelay),
    status: data.status,
    requestedAt: today(),
    chaseCount: data.status === "chased" ? 1 : 0,
    lastChasedAt: data.status === "chased" ? today() : "",
    receivedAt: data.status === "received" ? today() : "",
  });
  event.currentTarget.reset();
  saveState();
  render();
});

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

  const request = state.requests.find((item) => item.id === id);
  if (!request) return;

  if (action === "chase") {
    request.status = "chased";
    request.chaseCount += 1;
    request.lastChasedAt = today();
  }

  if (action === "receive") {
    request.status = "received";
    request.receivedAt = today();
  }

  if (action === "block") {
    request.status = "blocked";
  }

  if (action === "waiting") {
    request.status = "waiting";
  }

  saveState();
  render();
});

function render() {
  renderWorkstreamSelect();
  renderMetrics();
  renderCommandCenter();
  renderWorkstreams();
  renderRequests();
  renderPeople();
}

function renderWorkstreamSelect() {
  els.requestWorkstream.innerHTML = "";
  if (state.workstreams.length === 0) {
    const option = document.createElement("option");
    option.textContent = "Create a workstream first";
    option.value = "";
    els.requestWorkstream.append(option);
    els.requestForm.querySelector("button").disabled = true;
    return;
  }

  els.requestForm.querySelector("button").disabled = false;
  state.workstreams.forEach((workstream) => {
    const option = document.createElement("option");
    option.value = workstream.id;
    option.textContent = workstream.name;
    els.requestWorkstream.append(option);
  });
}

function renderMetrics() {
  const chase = activeRequests().filter(shouldChase);
  const atRisk = activeRequests().filter((request) => riskLevel(request) === "high");
  const back = state.requests.filter((request) => request.status === "received");
  const hours = state.workstreams.reduce((total, item) => total + Number(item.effort), 0);

  els.metricChase.textContent = chase.length;
  els.metricRisk.textContent = atRisk.length;
  els.metricBack.textContent = back.length;
  els.metricHours.textContent = `${hours}h`;
}

function renderCommandCenter() {
  const chase = activeRequests().filter(shouldChase).sort(byUrgency);
  const expected = activeRequests()
    .filter((request) => !shouldChase(request))
    .sort((a, b) => dateValue(expectedReturn(a)) - dateValue(expectedReturn(b)))
    .slice(0, 8);
  const back = state.requests
    .filter((request) => request.status === "received")
    .sort((a, b) => dateValue(b.receivedAt) - dateValue(a.receivedAt));

  renderCards(els.chaseList, chase);
  renderCards(els.expectedList, expected);
  renderCards(els.backList, back);
}

function renderWorkstreams() {
  const items = state.workstreams
    .slice()
    .sort((a, b) => dateValue(a.deadline) - dateValue(b.deadline))
    .map((workstream) => {
      const requests = state.requests.filter((request) => request.workstreamId === workstream.id);
      const open = requests.filter((request) => request.status !== "received");
      const blocked = requests.filter((request) => request.status === "blocked");
      const late = open.filter((request) => daysUntil(request.dueDate) < 0);
      const level = workstreamRisk(workstream, requests);
      return `
        <article class="workstream-card risk-${level}">
          <div class="card-title">
            <strong>${escapeHtml(workstream.name)}</strong>
            ${riskPill(level)}
          </div>
          <p class="meta">Final deadline ${formatDate(workstream.deadline)}. You still need about ${workstream.effort}h after inputs land.</p>
          <div class="pill-row">
            <span class="pill">${requests.length} requests</span>
            <span class="pill amber">${late.length} overdue</span>
            <span class="pill red">${blocked.length} blocked</span>
          </div>
        </article>
      `;
    });

  renderHtmlOrEmpty(els.workstreamBoard, items);
}

function renderRequests() {
  const items = state.requests.slice().sort(byUrgency).map(requestMarkup);
  renderHtmlOrEmpty(els.requestList, items);
}

function renderPeople() {
  const people = new Map();
  state.requests.forEach((request) => {
    const key = request.person.toLowerCase();
    if (!people.has(key)) {
      people.set(key, {
        name: request.person,
        total: 0,
        open: 0,
        overdue: 0,
        received: 0,
        chaseCount: 0,
        averageDelay: 0,
      });
    }
    const person = people.get(key);
    person.total += 1;
    person.chaseCount += request.chaseCount;
    if (request.status !== "received") person.open += 1;
    if (request.status === "received") person.received += 1;
    if (request.status !== "received" && daysUntil(request.dueDate) < 0) person.overdue += 1;
    person.averageDelay += Number(request.expectedDelay);
  });

  const items = [...people.values()]
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
    .map((person) => {
      const averageDelay = person.total ? Math.round(person.averageDelay / person.total) : 0;
      return `
        <article class="person-card">
          <div class="card-title">
            <strong>${escapeHtml(person.name)}</strong>
            <span class="pill">${person.open} open</span>
          </div>
          <div class="pill-row">
            <span class="pill amber">${person.overdue} overdue</span>
            <span class="pill">${person.chaseCount} chases</span>
            <span class="pill">${averageDelay === 0 ? "usually on time" : `avg +${averageDelay}d`}</span>
          </div>
        </article>
      `;
    });

  renderHtmlOrEmpty(els.peopleList, items);
}

function renderCards(container, requests) {
  renderHtmlOrEmpty(container, requests.map(requestMarkup));
}

function requestMarkup(request) {
  const workstream = findWorkstream(request.workstreamId);
  const level = riskLevel(request);
  return `
    <article class="request-card risk-${level}">
      <div class="card-title">
        <strong>${escapeHtml(request.person)}</strong>
        ${riskPill(level)}
      </div>
      <div>
        <p class="meta">${escapeHtml(request.inputNeeded)}</p>
        <p class="meta">${escapeHtml(workstream?.name || "Unknown workstream")} · due from them ${formatDate(request.dueDate)} · likely ${formatDate(expectedReturn(request))}</p>
      </div>
      <div class="pill-row">
        <span class="pill ${statusClass(request.status)}">${labelStatus(request.status)}</span>
        <span class="pill">${request.chaseCount} chases</span>
        <span class="pill">final ${formatDate(workstream?.deadline)}</span>
      </div>
      <div class="actions">
        <button data-action="chase" data-id="${request.id}">Chased today</button>
        <button data-action="receive" data-id="${request.id}">Received</button>
        <button data-action="block" data-id="${request.id}">Blocked</button>
        <button data-action="waiting" data-id="${request.id}">Waiting</button>
      </div>
    </article>
  `;
}

function renderHtmlOrEmpty(container, items) {
  if (items.length === 0) {
    container.innerHTML = document.querySelector("#empty-state").innerHTML;
    return;
  }
  container.innerHTML = items.join("");
}

function activeRequests() {
  return state.requests.filter((request) => request.status !== "received");
}

function shouldChase(request) {
  if (request.status === "blocked") return true;
  if (daysUntil(request.dueDate) <= 0) return true;
  const workstream = findWorkstream(request.workstreamId);
  if (!workstream) return false;
  return daysUntil(workstream.deadline) <= Number(workstream.effort) / 2 + 2;
}

function riskLevel(request) {
  if (request.status === "received") return "low";
  const workstream = findWorkstream(request.workstreamId);
  const overdue = daysUntil(request.dueDate) < 0;
  const finalSoon = workstream ? daysUntil(workstream.deadline) <= Math.ceil(Number(workstream.effort) / 2) + 1 : false;
  const expectedAfterDeadline = workstream ? dateValue(expectedReturn(request)) > dateValue(workstream.deadline) : false;

  if (request.status === "blocked" || (overdue && finalSoon) || expectedAfterDeadline) return "high";
  if (overdue || finalSoon || request.chaseCount > 0) return "medium";
  return "low";
}

function workstreamRisk(workstream, requests) {
  const openRequests = requests.filter((request) => request.status !== "received");
  if (openRequests.some((request) => riskLevel(request) === "high")) return "high";
  if (daysUntil(workstream.deadline) <= Math.ceil(Number(workstream.effort) / 2) + 1) return "high";
  if (openRequests.some((request) => riskLevel(request) === "medium")) return "medium";
  if (daysUntil(workstream.deadline) <= 5) return "medium";
  return "low";
}

function byUrgency(a, b) {
  const score = { high: 3, medium: 2, low: 1 };
  return score[riskLevel(b)] - score[riskLevel(a)] || dateValue(a.dueDate) - dateValue(b.dueDate);
}

function expectedReturn(request) {
  return addDays(request.dueDate, Number(request.expectedDelay));
}

function riskPill(level) {
  const label = level === "high" ? "At risk" : level === "medium" ? "Watch" : "Stable";
  const color = level === "high" ? "red" : level === "medium" ? "amber" : "green";
  return `<span class="pill ${color}">${label}</span>`;
}

function statusClass(status) {
  if (status === "blocked") return "red";
  if (status === "chased") return "amber";
  if (status === "received") return "green";
  return "";
}

function labelStatus(status) {
  return {
    waiting: "Waiting",
    chased: "Chased",
    received: "Back with me",
    blocked: "Blocked",
  }[status];
}

function findWorkstream(id) {
  return state.workstreams.find((workstream) => workstream.id === id);
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function makeRequest(workstreamId, person, inputNeeded, dueOffset, expectedDelay, status) {
  return {
    id: crypto.randomUUID(),
    workstreamId,
    person,
    inputNeeded,
    dueDate: offsetDate(dueOffset),
    expectedDelay,
    status,
    requestedAt: offsetDate(-4),
    chaseCount: status === "chased" || status === "blocked" ? 1 : 0,
    lastChasedAt: status === "chased" || status === "blocked" ? offsetDate(-1) : "",
    receivedAt: status === "received" ? today() : "",
  };
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
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

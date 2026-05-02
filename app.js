const KEY = "xau_journal_v6";
const LEGACY_KEY = "xau_journal_v5";

const FIXED = {
  sessions: ["Asian (5am-8am)", "Post-Asian (8am-10am)", "London (11am-2pm)", "Post-London (2pm-4pm)", "New York (5pm-8pm)", "Post-NY (8pm-3am)"],
  levels: ["SBR/TJL1", "RBS/TJL1", "TJL2", "QML", "FIB", "LVL4", "LVL2"],
  tfs: ["1m", "5m", "15m", "H1", "4H"],
  setups: ["A+", "A", "B"],
  mistakes: ["No mistake", "Early entry", "Late entry", "SL too tight", "Fear exit", "FOMO trade"],
  holds: ["Held full TP", "Partial + runner", "Early exit"],
  marketConditions: ["Bullish", "Bearish", "Ranging", "Choppy"],
  biasAlignments: ["With Trend", "Counter Trend"],
  confirmationTypes: ["BOS", "CHoCH", "Engulfing", "Pin Bar", "Rejection Wick", "None"],
  slTpPlacements: ["Above/Below Structure", "Fixed Pips", "ATR Based", "Arbitrary"]
};

const CAT_META = {
  sessions: { label: "Sessions" },
  levels: { label: "Levels" },
  tfs: { label: "Timeframes" },
  setups: { label: "Setup Quality" },
  mistakes: { label: "Mistake Types" },
  holds: { label: "Hold Quality" },
  marketConditions: { label: "Market Condition" },
  biasAlignments: { label: "Trade Direction vs Bias" },
  confirmationTypes: { label: "Confirmation Type" },
  slTpPlacements: { label: "SL/TP Placement" }
};

const DATE_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

let state = {
  trades: [],
  options: clone(FIXED),
  settings: { defaultRisk: "" },
  weeklyReviews: []
};

let pnlView = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: todayISO()
};

let modalEditingIndex = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.trades)) return;
    state.trades = parsed.trades.map(normalizeTrade);
    state.options = normalizeOptions(parsed.options || FIXED);
    state.settings = Object.assign({ defaultRisk: "" }, parsed.settings || {});
    state.weeklyReviews = Array.isArray(parsed.weeklyReviews) ? parsed.weeklyReviews.map(normalizeWeeklyReview) : [];
  } catch (error) {
    console.warn("Could not load journal state", error);
  }
}

function normalizeOptions(options) {
  const next = clone(FIXED);
  Object.keys(FIXED).forEach((key) => {
    const custom = Array.isArray(options[key]) ? options[key] : [];
    next[key] = Array.from(new Set([...FIXED[key], ...custom].filter(Boolean)));
  });
  return next;
}

function normalizeTrade(trade) {
  return {
    date: trade.date || "",
    session: trade.session || "",
    entry: trade.entry || "",
    level: trade.level || "",
    tf: trade.tf || "",
    setup: trade.setup || "",
    mistake: trade.mistake || "",
    hold: trade.hold || "",
    marketCondition: trade.marketCondition || "",
    biasAlignment: trade.biasAlignment || "",
    confirmationType: trade.confirmationType || "",
    slTpPlacement: trade.slTpPlacement || "",
    patienceScore: normalizePatienceScore(trade.patienceScore),
    risk: trade.risk || "",
    reward: trade.reward || "",
    result: trade.result || "",
    reason: trade.reason || trade.notes || "",
    pnl: trade.pnl ?? "",
    cum: trade.cum ?? ""
  };
}

function normalizePatienceScore(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return "";
  return String(Math.min(5, Math.max(1, n)));
}

function normalizeWeeklyReview(review) {
  return {
    id: review.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    weekOf: review.weekOf || "",
    learned: review.learned || "",
    pattern: review.pattern || "",
    improve: review.improve || "",
    createdAt: review.createdAt || new Date().toISOString()
  };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Could not save journal state", error);
  }
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatDateDisplay(iso) {
  if (!iso) return "";
  const parts = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return iso;
  const day = Number(parts[3]);
  const month = DATE_MONTHS[Number(parts[2]) - 1] || "";
  return `${day} ${month} ${parts[1]}`;
}

function parseDateInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const slash = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const named = text.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{2,4})$/);
  if (named) {
    const monthIndex = DATE_MONTHS.findIndex((month) => month.toLowerCase().startsWith(named[2].toLowerCase()));
    if (monthIndex >= 0) {
      const year = named[3].length === 2 ? `20${named[3]}` : named[3];
      return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
    }
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
    return parsed.toISOString().slice(0, 10);
  }
  return text;
}

function currentSession() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return "Asian (5am-8am)";
  if (hour >= 8 && hour < 10) return "Post-Asian (8am-10am)";
  if (hour >= 11 && hour < 14) return "London (11am-2pm)";
  if (hour >= 14 && hour < 16) return "Post-London (2pm-4pm)";
  if (hour >= 17 && hour < 20) return "New York (5pm-8pm)";
  return "Post-NY (8pm-3am)";
}

function calcRR(risk, reward) {
  const r = parseFloat(risk);
  const w = parseFloat(reward);
  if (!r || !w || Number.isNaN(r) || Number.isNaN(w)) return "";
  return `1:${(w / r).toFixed(2).replace(/\.00$/, "")}`;
}

function calcPnl(risk, reward, result) {
  if (!result) return "";
  if (result === "WIN") return round1(parseFloat(reward) || 0);
  if (result === "LOSS") return round1(-(parseFloat(risk) || 0));
  if (result === "BE") return 0;
  return "";
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function recalcCum() {
  let cum = 0;
  state.trades.forEach((trade) => {
    const pnl = calcPnl(trade.risk, trade.reward, trade.result);
    trade.pnl = pnl;
    if (pnl === "") {
      trade.cum = "";
      return;
    }
    cum = round1(cum + parseFloat(pnl || 0));
    trade.cum = cum;
  });
}

function performance() {
  recalcCum();
  const trades = state.trades;
  const closed = trades.filter((trade) => trade.result);
  const wins = closed.filter((trade) => trade.result === "WIN");
  const losses = closed.filter((trade) => trade.result === "LOSS");
  const bes = closed.filter((trade) => trade.result === "BE");
  const totalPnl = round1(trades.reduce((sum, trade) => sum + (parseFloat(trade.pnl) || 0), 0));
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgWin = wins.length ? wins.reduce((sum, trade) => sum + (parseFloat(trade.reward) || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, trade) => sum + (parseFloat(trade.risk) || 0), 0) / losses.length : 0;
  const grossWin = wins.reduce((sum, trade) => sum + (parseFloat(trade.pnl) || 0), 0);
  const grossLoss = losses.reduce((sum, trade) => sum + Math.abs(parseFloat(trade.pnl) || 0), 0);
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin ? grossWin : 0;
  const expectancy = closed.length ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss : 0;
  const cumVals = trades.filter((trade) => trade.cum !== "").map((trade) => parseFloat(trade.cum));
  const maxDrawdown = calcMaxDrawdown(cumVals);
  return { trades, closed, wins, losses, bes, totalPnl, winRate, avgWin, avgLoss, profitFactor, expectancy, maxDrawdown };
}

function calcMaxDrawdown(values) {
  let peak = 0;
  let maxDD = 0;
  values.forEach((value) => {
    peak = Math.max(peak, value);
    maxDD = Math.min(maxDD, value - peak);
  });
  return round1(maxDD);
}

function moneyClass(value) {
  const n = parseFloat(value);
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "neutral";
}

function signed(value, decimals = 1) {
  const n = parseFloat(value) || 0;
  return `${n > 0 ? "+" : ""}${n.toFixed(decimals)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function refreshIcons() {
  if (typeof window !== "undefined" && window.lucide) {
    window.lucide.createIcons();
  }
}

function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
}

function renderSummary() {
  const p = performance();
  const open = state.trades.length - p.closed.length;
  const strip = document.getElementById("summary-strip");
  if (strip) {
    strip.innerHTML = [
      metric("Closed Trades", p.closed.length, `${open} open`),
      metric("Win Rate", `${p.winRate.toFixed(1)}%`, `${p.wins.length}W / ${p.losses.length}L`, p.winRate >= 50 ? "pos" : "neg"),
      metric("Total P&L", `${signed(p.totalPnl)} pips`, "auto calculated", moneyClass(p.totalPnl)),
      metric("Profit Factor", p.profitFactor.toFixed(2), p.profitFactor >= 1 ? "Healthy" : "Needs work", p.profitFactor >= 1 ? "pos" : "neg"),
      metric("Expectancy", `${signed(p.expectancy)} pips`, "per closed trade", moneyClass(p.expectancy))
    ].join("");
  }

  const sidebar = document.getElementById("sidebar-stats");
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="stat-row"><span class="stat-label">Trades</span><span class="stat-val gold">${p.closed.length}</span></div>
      <div class="stat-row"><span class="stat-label">Win Rate</span><span class="stat-val ${p.winRate >= 50 ? "pos" : "neg"}">${p.winRate.toFixed(0)}%</span></div>
      <div class="stat-row"><span class="stat-label">Total P&L</span><span class="stat-val ${moneyClass(p.totalPnl)}">${signed(p.totalPnl)}</span></div>
      <div class="stat-row"><span class="stat-label">Drawdown</span><span class="stat-val ${p.maxDrawdown < 0 ? "neg" : "neutral"}">${signed(p.maxDrawdown)}</span></div>
    `;
  }

  const sub = document.getElementById("log-sub");
  if (sub) {
    sub.textContent = `${state.trades.length} trades saved, ${p.closed.length} closed, ${p.winRate.toFixed(0)}% win rate.`;
  }
}

function metric(label, value, note, cls = "") {
  return `
    <div class="metric-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value ${cls}">${escapeHtml(value)}</div>
      <div class="metric-note">${escapeHtml(note)}</div>
    </div>
  `;
}

function fillFilter(id, values, label) {
  const select = document.getElementById(id);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${label}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  select.value = values.includes(current) ? current : "";
}

function renderFilters() {
  fillFilter("session-filter", state.options.sessions || [], "All sessions");
  fillFilter("setup-filter", state.options.setups || [], "All setups");
}

function clearFilters() {
  ["search-input", "result-filter", "session-filter", "setup-filter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderTrades();
}

function filteredTrades() {
  const search = (document.getElementById("search-input")?.value || "").trim().toLowerCase();
  const result = document.getElementById("result-filter")?.value || "";
  const session = document.getElementById("session-filter")?.value || "";
  const setup = document.getElementById("setup-filter")?.value || "";

  return state.trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => {
      if (result === "OPEN" && trade.result) return false;
      if (result && result !== "OPEN" && trade.result !== result) return false;
      if (session && trade.session !== session) return false;
      if (setup && trade.setup !== setup) return false;
      if (!search) return true;
      const haystack = [trade.date, trade.session, trade.entry, trade.level, trade.tf, trade.setup, trade.mistake, trade.hold, trade.marketCondition, trade.biasAlignment, trade.confirmationType, trade.slTpPlacement, trade.patienceScore, trade.result, trade.reason].join(" ").toLowerCase();
      return haystack.includes(search);
    })
    .reverse();
}

function renderTrades() {
  recalcCum();
  renderSummary();
  const tbody = document.getElementById("trade-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = filteredTrades();
  if (!state.trades.length) {
    tbody.innerHTML = `<tr><td colspan="22"><div class="empty-state"><div><strong>No trades yet</strong><span>Click New Trade and the journal will auto-fill date and session.</span></div></div></td></tr>`;
    refreshIcons();
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="22"><div class="empty-state"><div><strong>No matching trades</strong><span>Clear filters to see the full journal.</span></div></div></td></tr>`;
    refreshIcons();
    return;
  }

  rows.forEach(({ trade, index }) => {
    const tr = document.createElement("tr");
    tr.className = trade.result === "WIN" ? "row-win" : trade.result === "LOSS" ? "row-loss" : trade.result === "BE" ? "row-be" : "";
    tr.appendChild(textCell("#", index + 1, "row-num"));
    tr.appendChild(displayCell("Date", formatDateDisplay(trade.date) || "-", "date-display"));
    tr.appendChild(displayCell("Session", trade.session || "-", "wrap-text"));
    tr.appendChild(htmlCell("Side", valuePill(trade.entry, "entry")));
    tr.appendChild(displayCell("Level", trade.level || "-", "wrap-text"));
    tr.appendChild(displayCell("TF", trade.tf || "-", "mono"));
    tr.appendChild(htmlCell("Setup", valuePill(trade.setup, "setup")));
    tr.appendChild(displayCell("Mistake", trade.mistake || "-", "wrap-text"));
    tr.appendChild(displayCell("Hold", trade.hold || "-", "wrap-text"));
    tr.appendChild(displayCell("Market", trade.marketCondition || "-", "wrap-text"));
    tr.appendChild(displayCell("Bias", trade.biasAlignment || "-", "wrap-text"));
    tr.appendChild(displayCell("Confirm", trade.confirmationType || "-", "wrap-text"));
    tr.appendChild(displayCell("SL/TP", trade.slTpPlacement || "-", "wrap-text"));
    tr.appendChild(htmlCell("Patience", patienceBadge(index, trade.patienceScore)));
    tr.appendChild(displayCell("Risk", trade.risk || "-", "mono"));
    tr.appendChild(displayCell("Reward", trade.reward || "-", "mono"));
    tr.appendChild(htmlCell("RR", `<span class="rr">${escapeHtml(calcRR(trade.risk, trade.reward) || "-")}</span>`));
    tr.appendChild(htmlCell("Result", valuePill(trade.result, "result")));
    tr.appendChild(htmlCell("P&L", pnlHtml(trade.pnl)));
    tr.appendChild(htmlCell("Cum", pnlHtml(trade.cum)));
    tr.appendChild(displayCell("Notes", trade.reason || "-", "notes-preview"));
    tr.appendChild(actionCell("Actions", index));
    tbody.appendChild(tr);
  });

  refreshIcons();
}

function textCell(label, value, cls = "") {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.className = cls;
  td.textContent = value;
  return td;
}

function htmlCell(label, html) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.innerHTML = html;
  return td;
}

function displayCell(label, value, cls = "") {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.className = cls;
  td.textContent = value;
  td.title = value;
  return td;
}

function valuePill(value, type) {
  if (!value) return `<span class="table-pill pill-empty">-</span>`;
  const key = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `<span class="table-pill pill-${type} pill-${key}">${escapeHtml(value)}</span>`;
}

function patienceBadge(index, score) {
  const current = parseInt(score, 10) || 0;
  return `<button class="patience-badge ${current ? "active" : ""}" onclick="cyclePatienceScore(${index})" title="Click to cycle patience score">${current ? `P${current}` : "-"}</button>`;
}

function setPatienceScore(index, value) {
  updateTrade(index, "patienceScore", normalizePatienceScore(value));
}

function cyclePatienceScore(index) {
  const current = parseInt(state.trades[index]?.patienceScore, 10) || 0;
  const next = current >= 5 ? "" : String(current + 1);
  updateTrade(index, "patienceScore", next);
}

function dateCell(label, value, onChange) {
  const td = document.createElement("td");
  td.dataset.label = label;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "date-text";
  input.placeholder = "1 June 2026";
  input.value = formatDateDisplay(value);
  input.addEventListener("focus", () => {
    input.value = value || "";
    input.select();
  });
  input.addEventListener("blur", () => {
    const parsed = parseDateInput(input.value);
    onChange(parsed);
    input.value = formatDateDisplay(parsed);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
  td.appendChild(input);
  return td;
}

function inputCell(label, type, value, onInput, onChange) {
  const td = document.createElement("td");
  td.dataset.label = label;
  const input = document.createElement("input");
  input.type = type;
  input.className = "number-input";
  input.value = value || "";
  if (type === "number") {
    input.step = "0.1";
    input.min = "0";
  }
  input.addEventListener("input", () => onInput(input.value));
  input.addEventListener("change", () => {
    onInput(input.value);
    if (onChange) onChange(input.value);
  });
  td.appendChild(input);
  return td;
}

function selectCell(label, values, value, onChange, field) {
  const td = document.createElement("td");
  td.dataset.label = label;
  const select = document.createElement("select");
  select.className = selectClass(field, value);
  select.title = value || label;
  select.appendChild(new Option("-", ""));
  (values || []).forEach((item) => select.appendChild(new Option(item, item)));
  select.value = value || "";
  select.addEventListener("change", () => onChange(select.value));
  td.appendChild(select);
  return td;
}

function selectClass(field, value) {
  const base = ["data-select", `field-${field}`];
  const normalized = String(value || "empty").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (value) base.push("is-filled");
  base.push(`value-${normalized || "empty"}`);
  return base.join(" ");
}

function textareaCell(label, value, onChange) {
  const td = document.createElement("td");
  td.dataset.label = label;
  const textarea = document.createElement("textarea");
  textarea.value = value || "";
  textarea.placeholder = "Why did you take it?";
  textarea.addEventListener("input", () => onChange(textarea.value));
  td.appendChild(textarea);
  return td;
}

function actionCell(label, index) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.className = "action-cell";
  const edit = document.createElement("button");
  edit.className = "icon-btn";
  edit.title = "Edit trade";
  edit.innerHTML = `<i data-lucide="pencil"></i>`;
  edit.addEventListener("click", () => openTradeModal(index));
  const del = document.createElement("button");
  del.className = "icon-btn";
  del.title = "Delete trade";
  del.innerHTML = `<i data-lucide="trash-2"></i>`;
  del.addEventListener("click", () => deleteTrade(index));
  td.appendChild(edit);
  td.appendChild(del);
  return td;
}

function pnlHtml(value) {
  if (value === "" || value === null || value === undefined) return `<span class="neutral">-</span>`;
  return `<span class="mono ${moneyClass(value)}">${signed(value)}</span>`;
}

function updateTrade(index, field, value, rerender = true) {
  state.trades[index][field] = value;
  save();
  if (rerender) renderTrades();
  else renderSummary();
  if (document.getElementById("tab-pnl")?.classList.contains("active")) renderPnl();
}

function newTradeTemplate(source) {
  const base = source ? clone(source) : {};
  return normalizeTrade({
    ...base,
    date: todayISO(),
    session: base.session || currentSession(),
    mistake: base.mistake || "No mistake",
    risk: base.risk || state.settings.defaultRisk || "",
    result: source ? "" : base.result || "",
    reason: source ? "" : base.reason || ""
  });
}

function addTrade() {
  openTradeModal();
}

function duplicateLastTrade() {
  if (!state.trades.length) {
    addTrade();
    return;
  }
  openTradeModal(null, newTradeTemplate(state.trades[state.trades.length - 1]));
}

function fillModalSelect(id, values, placeholder = "Select", cat = "") {
  const select = document.getElementById(id);
  if (!select) return;
  select.dataset.cat = cat;
  select.innerHTML = `<option value="">${placeholder}</option>` + (values || []).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("") + (cat ? `<option value="__add_custom__">+ Add Custom</option>` : "");
  select.onchange = () => {
    if (select.value === "__add_custom__") handleModalCustomOption(select);
  };
}

function setModalValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

function openTradeModal(index = null, draft = null) {
  modalEditingIndex = Number.isInteger(index) ? index : null;
  fillModalSelect("modal-session", state.options.sessions, "Select", "sessions");
  fillModalSelect("modal-level", state.options.levels, "Select", "levels");
  fillModalSelect("modal-tf", state.options.tfs, "Select", "tfs");
  fillModalSelect("modal-setup", state.options.setups, "Select", "setups");
  fillModalSelect("modal-hold", state.options.holds, "Select", "holds");
  fillModalSelect("modal-mistake", state.options.mistakes, "Select", "mistakes");
  fillModalSelect("modal-market-condition", state.options.marketConditions, "Select", "marketConditions");
  fillModalSelect("modal-bias-alignment", state.options.biasAlignments, "Select", "biasAlignments");
  fillModalSelect("modal-confirmation-type", state.options.confirmationTypes, "Select", "confirmationTypes");
  fillModalSelect("modal-sl-tp-placement", state.options.slTpPlacements, "Select", "slTpPlacements");

  const trade = draft || (modalEditingIndex === null ? newTradeTemplate() : state.trades[modalEditingIndex]);
  const title = document.getElementById("trade-modal-title");
  if (title) title.textContent = modalEditingIndex === null ? "NEW_TRADE" : `EDIT_TRADE #${modalEditingIndex + 1}`;
  setModalValue("modal-date", trade.date || todayISO());
  setModalValue("modal-session", trade.session);
  setModalValue("modal-entry", trade.entry);
  setModalValue("modal-level", trade.level);
  setModalValue("modal-tf", trade.tf);
  setModalValue("modal-result", trade.result);
  setModalValue("modal-setup", trade.setup);
  setModalValue("modal-hold", trade.hold);
  setModalValue("modal-mistake", trade.mistake);
  setModalValue("modal-market-condition", trade.marketCondition);
  setModalValue("modal-bias-alignment", trade.biasAlignment);
  setModalValue("modal-confirmation-type", trade.confirmationType);
  setModalValue("modal-sl-tp-placement", trade.slTpPlacement);
  setModalValue("modal-patience-score", trade.patienceScore);
  setModalValue("modal-risk", trade.risk);
  setModalValue("modal-reward", trade.reward);
  setModalValue("modal-reason", trade.reason);

  const modal = document.getElementById("trade-modal");
  if (modal) {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => document.getElementById("modal-date")?.focus(), 40);
  }
  refreshIcons();
}

function handleModalCustomOption(select) {
  const cat = select.dataset.cat;
  const label = CAT_META[cat]?.label || "Option";
  const value = prompt(`Add custom ${label}:`)?.trim();
  if (!cat || !value) {
    select.value = "";
    return;
  }
  if (!state.options[cat]) state.options[cat] = [];
  if (!state.options[cat].includes(value)) {
    state.options[cat].push(value);
    save();
  }
  fillModalSelect(select.id, state.options[cat], "Select", cat);
  select.value = value;
  renderFilters();
  if (document.getElementById("tab-manage")?.classList.contains("active")) renderManage();
  if (document.getElementById("tab-analysis")?.classList.contains("active")) renderAnalysis();
}

function closeTradeModal() {
  const modal = document.getElementById("trade-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("modal-open");
  modalEditingIndex = null;
}

function modalTradeData() {
  return normalizeTrade({
    date: document.getElementById("modal-date")?.value || todayISO(),
    session: document.getElementById("modal-session")?.value || "",
    entry: document.getElementById("modal-entry")?.value || "",
    level: document.getElementById("modal-level")?.value || "",
    tf: document.getElementById("modal-tf")?.value || "",
    setup: document.getElementById("modal-setup")?.value || "",
    mistake: document.getElementById("modal-mistake")?.value || "",
    hold: document.getElementById("modal-hold")?.value || "",
    marketCondition: document.getElementById("modal-market-condition")?.value || "",
    biasAlignment: document.getElementById("modal-bias-alignment")?.value || "",
    confirmationType: document.getElementById("modal-confirmation-type")?.value || "",
    slTpPlacement: document.getElementById("modal-sl-tp-placement")?.value || "",
    patienceScore: normalizePatienceScore(document.getElementById("modal-patience-score")?.value || ""),
    risk: document.getElementById("modal-risk")?.value || "",
    reward: document.getElementById("modal-reward")?.value || "",
    result: document.getElementById("modal-result")?.value || "",
    reason: document.getElementById("modal-reason")?.value || ""
  });
}

function saveTradeFromModal() {
  const trade = modalTradeData();
  if (!trade.date) {
    toast("Date required.");
    return;
  }
  const isEdit = modalEditingIndex !== null;
  if (modalEditingIndex === null) {
    state.trades.push(trade);
  } else {
    state.trades[modalEditingIndex] = trade;
  }
  save();
  renderTrades();
  if (document.getElementById("tab-pnl")?.classList.contains("active")) renderPnl();
  scrollToLastRow();
  closeTradeModal();
  toast(isEdit ? "Trade updated." : "Trade saved.");
}

function deleteTrade(index) {
  state.trades.splice(index, 1);
  save();
  renderTrades();
  if (document.getElementById("tab-pnl")?.classList.contains("active")) renderPnl();
  toast("Trade deleted.");
}

function scrollToLastRow() {
  setTimeout(() => {
    const shell = document.querySelector("#tab-log .table-shell");
    if (shell) shell.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector("#trade-body tr")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, 40);
}

function renderAnalysis() {
  const el = document.getElementById("analysis-content");
  if (!el) return;
  const p = performance();
  const streaks = streakStats();
  el.innerHTML = `
    <div class="dashboard-strip" style="padding:0 0 14px">
      ${metric("Total Trades", p.closed.length, `${state.trades.length - p.closed.length} open`)}
      ${metric("Wins", p.wins.length, "closed winners", "pos")}
      ${metric("Losses", p.losses.length, "closed losses", "neg")}
      ${metric("Avg Win", `${p.avgWin.toFixed(1)} pips`, "winning trades", "pos")}
      ${metric("Avg Loss", `${p.avgLoss.toFixed(1)} pips`, "losing trades", "neg")}
    </div>
    <div class="dashboard-strip" style="padding:0 0 14px">
      ${metric("Current Win Streak", streaks.currentWin, "latest closed trades", streaks.currentWin ? "pos" : "neutral")}
      ${metric("Current Loss Streak", streaks.currentLoss, "latest closed trades", streaks.currentLoss ? "neg" : "neutral")}
      ${metric("Best Win Streak", streaks.bestWin, "all time", "pos")}
      ${metric("Worst Loss Streak", streaks.worstLoss, "all time", streaks.worstLoss ? "neg" : "neutral")}
      ${metric("Patience Edge", streaks.bestWin || streaks.worstLoss ? "Tracked" : "-", "streak tracker")}
    </div>
    <div class="analysis-grid">
      <div class="panel panel-pad">
        <div class="panel-title"><span>Equity Curve</span><span class="${moneyClass(p.totalPnl)}">${signed(p.totalPnl)} pips</span></div>
        ${equitySvg()}
      </div>
      <div class="panel panel-pad">
        <div class="panel-title"><span>Auto Insights</span><span class="neutral">${p.closed.length} closed</span></div>
        <div class="insight-list">${insightHtml()}</div>
      </div>
    </div>
    ${analysisTable("Level Analysis", "levels", "level")}
    ${analysisTable("Timeframe Analysis", "tfs", "tf")}
    ${analysisTable("Session Analysis", "sessions", "session")}
    ${analysisTable("Setup Quality Analysis", "setups", "setup")}
    ${analysisTable("Mistake Type Analysis", "mistakes", "mistake")}
    ${analysisTable("Hold Quality Analysis", "holds", "hold")}
    ${analysisTable("Market Condition Analysis", "marketConditions", "marketCondition")}
    ${analysisTable("Confirmation Type Analysis", "confirmationTypes", "confirmationType")}
    ${analysisTable("SL/TP Placement Analysis", "slTpPlacements", "slTpPlacement")}
    ${patienceAnalysis()}
    ${crossTable()}
  `;
  refreshIcons();
}

function equitySvg() {
  recalcCum();
  const values = [0, ...state.trades.filter((trade) => trade.cum !== "").map((trade) => parseFloat(trade.cum))];
  if (values.length <= 1) {
    return `<div class="empty-state" style="min-height:210px"><div><strong>No equity curve yet</strong><span>Close trades to build the curve automatically.</span></div></div>`;
  }
  const width = 720;
  const height = 210;
  const pad = 18;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(max - min, 1);
  const points = values.map((value, index) => {
    const x = pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const zeroY = height - pad - ((0 - min) / span) * (height - pad * 2);
  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Equity curve">
      <defs>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f0bd55" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#f0bd55" stop-opacity="0" />
        </linearGradient>
      </defs>
      <line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${width - pad}" y2="${zeroY.toFixed(1)}" stroke="rgba(255,255,255,.16)" stroke-dasharray="5 5" />
      <polyline points="${pad},${height - pad} ${points} ${width - pad},${height - pad}" fill="url(#curveFill)" stroke="none" />
      <polyline points="${points}" fill="none" stroke="#f0bd55" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function insightHtml() {
  const p = performance();
  if (!p.closed.length) {
    return insight("clipboard-list", "Start with clean data", "Close a few trades and this panel will find your best setup, weakest mistake, and session edge.");
  }
  const bestLevel = bestGroup("levels", "level", "pnl");
  const bestSession = bestGroup("sessions", "session", "winrate");
  const costlyMistake = worstGroup("mistakes", "mistake");
  const streak = currentStreak();
  return [
    insight("trophy", "Best level", bestLevel ? `${bestLevel.key}: ${signed(bestLevel.pnl)} pips across ${bestLevel.count} trades.` : "No clear level edge yet."),
    insight("clock-3", "Best session", bestSession ? `${bestSession.key}: ${bestSession.winRate.toFixed(0)}% win rate.` : "No clear session edge yet."),
    insight("alert-triangle", "Costly mistake", costlyMistake ? `${costlyMistake.key}: ${signed(costlyMistake.pnl)} pips. Reduce this first.` : "No mistake pattern detected."),
    insight(streak.type === "WIN" ? "flame" : "activity", "Current streak", streak.count ? `${streak.count} ${streak.type.toLowerCase()} trade(s) in a row.` : "No closed streak yet.")
  ].join("");
}

function insight(icon, title, text) {
  return `
    <div class="insight">
      <div class="insight-icon"><i data-lucide="${icon}"></i></div>
      <div><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div>
    </div>
  `;
}

function grouped(catKey, field) {
  const p = performance();
  return (state.options[catKey] || []).map((key) => {
    const group = p.closed.filter((trade) => trade[field] === key);
    const wins = group.filter((trade) => trade.result === "WIN").length;
    const pnl = round1(group.reduce((sum, trade) => sum + (parseFloat(trade.pnl) || 0), 0));
    return { key, group, count: group.length, wins, pnl, winRate: group.length ? (wins / group.length) * 100 : 0 };
  }).filter((item) => item.count > 0);
}

function bestGroup(catKey, field, sortBy) {
  const groups = grouped(catKey, field);
  if (!groups.length) return null;
  return groups.sort((a, b) => sortBy === "winrate" ? b.winRate - a.winRate || b.pnl - a.pnl : b.pnl - a.pnl)[0];
}

function worstGroup(catKey, field) {
  const groups = grouped(catKey, field).filter((item) => item.key !== "No mistake");
  if (!groups.length) return null;
  return groups.sort((a, b) => a.pnl - b.pnl)[0];
}

function currentStreak() {
  const closed = state.trades.filter((trade) => trade.result === "WIN" || trade.result === "LOSS");
  if (!closed.length) return { type: "", count: 0 };
  const type = closed[closed.length - 1].result;
  let count = 0;
  for (let i = closed.length - 1; i >= 0; i -= 1) {
    if (closed[i].result !== type) break;
    count += 1;
  }
  return { type, count };
}

function streakStats() {
  const closed = state.trades.filter((trade) => trade.result === "WIN" || trade.result === "LOSS");
  let currentWin = 0;
  let currentLoss = 0;
  if (closed.length) {
    const last = closed[closed.length - 1].result;
    for (let i = closed.length - 1; i >= 0; i -= 1) {
      if (closed[i].result !== last) break;
      if (last === "WIN") currentWin += 1;
      if (last === "LOSS") currentLoss += 1;
    }
  }
  let bestWin = 0;
  let worstLoss = 0;
  let winRun = 0;
  let lossRun = 0;
  closed.forEach((trade) => {
    if (trade.result === "WIN") {
      winRun += 1;
      lossRun = 0;
    } else {
      lossRun += 1;
      winRun = 0;
    }
    bestWin = Math.max(bestWin, winRun);
    worstLoss = Math.max(worstLoss, lossRun);
  });
  return { currentWin, currentLoss, bestWin, worstLoss };
}

function avgPatienceFor(result) {
  const rows = performance().closed.filter((trade) => trade.result === result && trade.patienceScore);
  if (!rows.length) return "-";
  const avg = rows.reduce((sum, trade) => sum + (parseInt(trade.patienceScore, 10) || 0), 0) / rows.length;
  return avg.toFixed(2);
}

function patienceWinRate(predicate) {
  const rows = performance().closed.filter((trade) => trade.patienceScore && predicate(parseInt(trade.patienceScore, 10)));
  if (!rows.length) return "-";
  const wins = rows.filter((trade) => trade.result === "WIN").length;
  return `${(wins / rows.length * 100).toFixed(1)}%`;
}

function patienceAnalysis() {
  return `
    <div class="a-section">
      <div class="panel-title"><span>Patience Score Analysis</span></div>
      <div class="patience-grid">
        ${metric("WIN Avg Patience", avgPatienceFor("WIN"), "winning trades", "pos")}
        ${metric("LOSS Avg Patience", avgPatienceFor("LOSS"), "losing trades", "neg")}
        ${metric("BE Avg Patience", avgPatienceFor("BE"), "break-even trades", "neutral")}
        ${metric("Score <=2 Win Rate", patienceWinRate((score) => score <= 2), "low patience")}
        ${metric("Score >=4 Win Rate", patienceWinRate((score) => score >= 4), "high patience")}
      </div>
      <div class="notice" style="margin:12px 0 0">Avg patience score when score <=2: ${patienceWinRate((score) => score <= 2)} win rate vs Avg patience score when score >=4: ${patienceWinRate((score) => score >= 4)} win rate.</div>
    </div>
  `;
}

function analysisTable(title, catKey, field) {
  const rows = (state.options[catKey] || []).map((key) => {
    const g = grouped(catKey, field).find((item) => item.key === key) || { key, count: 0, wins: 0, pnl: 0, winRate: 0, group: [] };
    const losses = g.group.filter((trade) => trade.result === "LOSS").length;
    const bes = g.group.filter((trade) => trade.result === "BE").length;
    const avgRR = g.wins ? g.group.filter((trade) => trade.result === "WIN").reduce((sum, trade) => {
      const risk = parseFloat(trade.risk) || 1;
      return sum + ((parseFloat(trade.reward) || 0) / Math.max(risk, 0.001));
    }, 0) / g.wins : 0;
    const color = g.winRate >= 60 ? "var(--green)" : g.winRate >= 40 ? "var(--amber)" : "var(--red)";
    return `
      <tr>
        <td class="key-cell">${escapeHtml(key)}</td>
        <td>${g.count}</td>
        <td class="pos">${g.wins}</td>
        <td class="neg">${losses}</td>
        <td class="neutral">${bes}</td>
        <td>
          <div class="wr-cell">
            <div class="wr-bar"><div class="wr-fill" style="width:${g.winRate.toFixed(0)}%;background:${color}"></div></div>
            <span>${g.count ? `${g.winRate.toFixed(0)}%` : "-"}</span>
          </div>
        </td>
        <td class="${moneyClass(g.pnl)}">${g.count ? signed(g.pnl) : "-"}</td>
        <td>${avgRR ? `1:${avgRR.toFixed(2)}` : "-"}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="a-section">
      <div class="panel-title"><span>${escapeHtml(title)}</span></div>
      <div class="table-shell" style="margin:0">
        <table class="a-table">
          <thead><tr><th>Name</th><th>Trades</th><th>Wins</th><th>Losses</th><th>BE</th><th>Win Rate</th><th>Total P&L</th><th>Avg Win RR</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function crossTable() {
  const levels = state.options.levels || [];
  const tfs = state.options.tfs || [];
  const closed = performance().closed;
  const rows = levels.map((level) => {
    const cells = tfs.map((tf) => {
      const group = closed.filter((trade) => trade.level === level && trade.tf === tf);
      if (!group.length) return `<td class="cell-nil">-</td>`;
      const wr = (group.filter((trade) => trade.result === "WIN").length / group.length) * 100;
      const cls = wr >= 60 ? "cell-high" : wr >= 40 ? "cell-mid" : "cell-low";
      return `<td class="${cls}">${wr.toFixed(0)}%</td>`;
    }).join("");
    return `<tr><td class="key-cell">${escapeHtml(level)}</td>${cells}</tr>`;
  }).join("");

  return `
    <div class="a-section">
      <div class="panel-title"><span>Level x Timeframe Win Rate</span></div>
      <div class="cross-wrap">
        <table>
          <thead><tr><th>Level / TF</th>${tfs.map((tf) => `<th>${escapeHtml(tf)}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function isoFromParts(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthTitle(year, month) {
  return `${DATE_MONTHS[month]} ${year}`;
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function dayName(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
}

function dailyPnlMap() {
  recalcCum();
  const map = new Map();
  state.trades.forEach((trade, index) => {
    if (!trade.date || !trade.result) return;
    if (!map.has(trade.date)) map.set(trade.date, { date: trade.date, pnl: 0, trades: 0, wins: 0, losses: 0, bes: 0, indexes: [] });
    const day = map.get(trade.date);
    day.pnl = round1(day.pnl + (parseFloat(trade.pnl) || 0));
    day.trades += 1;
    day.wins += trade.result === "WIN" ? 1 : 0;
    day.losses += trade.result === "LOSS" ? 1 : 0;
    day.bes += trade.result === "BE" ? 1 : 0;
    day.indexes.push(index + 1);
  });
  return map;
}

function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return {
      iso: toISODate(d),
      day: d.getDate(),
      inMonth: d.getMonth() === month
    };
  });
}

function pnlClass(pnl, maxAbs) {
  if (!pnl) return "pnl-no-data";
  const ratio = Math.abs(pnl) / Math.max(maxAbs, 1);
  if (pnl < 0) {
    if (ratio >= 0.66) return "pnl-heavy-loss";
    if (ratio >= 0.28) return "pnl-moderate-loss";
    return "pnl-minor-loss";
  }
  if (ratio >= 0.66) return "pnl-strong-gain";
  if (ratio >= 0.28) return "pnl-moderate-gain";
  return "pnl-minor-gain";
}

function monthPnlStats(year, month) {
  const map = dailyPnlMap();
  const days = Array.from(map.values()).filter((day) => {
    const d = new Date(`${day.date}T00:00:00`);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const tradingDays = days.length;
  const totalTrades = days.reduce((sum, day) => sum + day.trades, 0);
  const profitable = days.filter((day) => day.pnl > 0).length;
  const losing = days.filter((day) => day.pnl < 0).length;
  const totalPnl = round1(days.reduce((sum, day) => sum + day.pnl, 0));
  const avgDaily = tradingDays ? round1(totalPnl / tradingDays) : 0;
  const best = days.length ? days.slice().sort((a, b) => b.pnl - a.pnl)[0] : null;
  const worst = days.length ? days.slice().sort((a, b) => a.pnl - b.pnl)[0] : null;
  const winRate = tradingDays ? profitable / tradingDays * 100 : 0;
  const maxAbs = days.length ? Math.max(...days.map((day) => Math.abs(day.pnl)), 1) : 1;
  return { map, days, tradingDays, totalTrades, profitable, losing, totalPnl, avgDaily, best, worst, winRate, maxAbs };
}

function renderPnl() {
  const el = document.getElementById("pnl-content");
  if (!el) return;
  const { year, month } = pnlView;
  const stats = monthPnlStats(year, month);
  if (!pnlView.selectedDate || !pnlView.selectedDate.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) {
    pnlView.selectedDate = isoFromParts(year, month, 1);
  }
  const cells = monthCells(year, month);
  const weekRows = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    const weekPnl = round1(week.reduce((sum, cell) => sum + (stats.map.get(cell.iso)?.pnl || 0), 0));
    const weekTrades = week.reduce((sum, cell) => sum + (stats.map.get(cell.iso)?.trades || 0), 0);
    weekRows.push({ week, weekPnl, weekTrades, weekNo: weekRows.length + 1 });
  }
  const selected = stats.map.get(pnlView.selectedDate);
  const selectedLabel = `${dayName(pnlView.selectedDate)}, ${formatDateDisplay(pnlView.selectedDate)}`;

  el.innerHTML = `
    <div class="pnl-layout">
      <div class="pnl-calendar-panel">
        <div class="pnl-monthbar">
          <button class="icon-btn" onclick="changePnlMonth(-1)" title="Previous month"><i data-lucide="chevron-left"></i></button>
          <div>
            <h2>${escapeHtml(monthTitle(year, month))}</h2>
            <p>Daily P&L in pips</p>
          </div>
          <button class="icon-btn" onclick="changePnlMonth(1)" title="Next month"><i data-lucide="chevron-right"></i></button>
        </div>
        <div class="pnl-scale"><span>Loss</span><div></div><span>Profit</span></div>
        <div class="pnl-legend">
          ${legendItem("pnl-heavy-loss", "Heavy Loss")}
          ${legendItem("pnl-moderate-loss", "Moderate Loss")}
          ${legendItem("pnl-minor-loss", "Minor Loss")}
          ${legendItem("pnl-no-data", "No Trades")}
          ${legendItem("pnl-minor-gain", "Minor Gain")}
          ${legendItem("pnl-moderate-gain", "Moderate Gain")}
          ${legendItem("pnl-strong-gain", "Strong Gain")}
        </div>
        <div class="pnl-grid">
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Week"].map((label) => `<div class="pnl-weekday">${label}</div>`).join("")}
          ${weekRows.map((row) => `
            ${row.week.map((cell) => pnlDayCell(cell, stats)).join("")}
            <div class="pnl-week-total ${pnlClass(row.weekPnl, stats.maxAbs)}">
              <b>Week ${row.weekNo}</b>
              <strong>${signed(row.weekPnl)} pips</strong>
              <span>${row.weekTrades} trade${row.weekTrades === 1 ? "" : "s"}</span>
            </div>
          `).join("")}
        </div>
      </div>
      <aside class="pnl-side-panel">
        <div class="pnl-stat-grid">
          ${pnlStat("Trading Days", stats.tradingDays)}
          ${pnlStat("Total Trades", stats.totalTrades)}
          ${pnlStat("Profitable", stats.profitable)}
          ${pnlStat("Losing", stats.losing)}
        </div>
        <div class="pnl-total-card ${moneyClass(stats.totalPnl)}">
          <span>Total P/L</span>
          <b>${signed(stats.totalPnl)} pips</b>
        </div>
        <div class="pnl-info-card">
          <span>Avg Daily P/L</span>
          <b>${signed(stats.avgDaily)} pips</b>
        </div>
        <div class="pnl-info-card">
          <span><i data-lucide="trending-up"></i> Best Day</span>
          <b class="pos">${stats.best ? `${signed(stats.best.pnl)} pips` : "-"}</b>
          <small>${stats.best ? formatDateDisplay(stats.best.date) : "No data"}</small>
        </div>
        <div class="pnl-info-card">
          <span><i data-lucide="trending-down"></i> Worst Day</span>
          <b class="neg">${stats.worst ? `${signed(stats.worst.pnl)} pips` : "-"}</b>
          <small>${stats.worst ? formatDateDisplay(stats.worst.date) : "No data"}</small>
        </div>
        <div class="pnl-win-note">
          <i data-lucide="lightbulb"></i>
          <span>Win Rate: <b>${stats.winRate.toFixed(1)}%</b> of your trading days are profitable.</span>
        </div>
        <div class="pnl-selected-card">
          <button onclick="clearPnlSelection()" title="Clear selection"><i data-lucide="x"></i></button>
          <span>Selected Day</span>
          <b>${escapeHtml(selectedLabel)}</b>
          <p>${selected ? `${selected.trades} trade${selected.trades === 1 ? "" : "s"}  ${signed(selected.pnl)} pips` : "No trades"}</p>
        </div>
      </aside>
    </div>
  `;
  refreshIcons();
}

function legendItem(cls, label) {
  return `<span><i class="${cls}"></i>${escapeHtml(label)}</span>`;
}

function pnlStat(label, value) {
  return `<div class="pnl-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function pnlDayCell(cell, stats) {
  const day = stats.map.get(cell.iso);
  const cls = pnlClass(day?.pnl || 0, stats.maxAbs);
  const selected = cell.iso === pnlView.selectedDate ? "selected" : "";
  const muted = cell.inMonth ? "" : "muted";
  return `
    <button class="pnl-day ${cls} ${selected} ${muted}" onclick="selectPnlDay('${cell.iso}')">
      <span>${cell.day}</span>
      <b>${day ? `${signed(day.pnl)} pips` : "No data"}</b>
      <small>${day ? `${day.trades} trade${day.trades === 1 ? "" : "s"}` : ""}</small>
    </button>
  `;
}

function selectPnlDay(iso) {
  pnlView.selectedDate = iso;
  renderPnl();
}

function clearPnlSelection() {
  pnlView.selectedDate = isoFromParts(pnlView.year, pnlView.month, 1);
  renderPnl();
}

function changePnlMonth(delta) {
  const d = new Date(pnlView.year, pnlView.month + delta, 1);
  pnlView.year = d.getFullYear();
  pnlView.month = d.getMonth();
  pnlView.selectedDate = isoFromParts(pnlView.year, pnlView.month, 1);
  renderPnl();
}

function goCurrentPnlMonth() {
  const d = new Date();
  pnlView.year = d.getFullYear();
  pnlView.month = d.getMonth();
  pnlView.selectedDate = todayISO();
  renderPnl();
}

function toISODate(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function weekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  const start = new Date(d);
  start.setDate(d.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: toISODate(start), to: toISODate(end) };
}

function monthRange(date = new Date()) {
  const d = new Date(date);
  return {
    from: toISODate(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  };
}

function applyReportPreset() {
  const preset = document.getElementById("report-preset")?.value || "all";
  const from = document.getElementById("report-from");
  const to = document.getElementById("report-to");
  if (!from || !to) return;
  if (preset === "week") {
    const range = weekRange();
    from.value = range.from;
    to.value = range.to;
  } else if (preset === "month") {
    const range = monthRange();
    from.value = range.from;
    to.value = range.to;
  } else if (preset === "all") {
    from.value = "";
    to.value = "";
  }
}

function setCustomReportRange() {
  const preset = document.getElementById("report-preset");
  if (preset) preset.value = "custom";
}

function reportRange() {
  const preset = document.getElementById("report-preset")?.value || "all";
  let from = document.getElementById("report-from")?.value || "";
  let to = document.getElementById("report-to")?.value || "";
  if (preset === "week" && (!from || !to)) ({ from, to } = weekRange());
  if (preset === "month" && (!from || !to)) ({ from, to } = monthRange());
  return { preset, from, to };
}

function tradesForRange(range = reportRange()) {
  recalcCum();
  return state.trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => {
      if (range.from && (!trade.date || trade.date < range.from)) return false;
      if (range.to && (!trade.date || trade.date > range.to)) return false;
      return true;
    })
    .reverse();
}

function reportPerformance(items) {
  let cum = 0;
  const chronologicalItems = items.slice().reverse();
  const chronologicalRows = chronologicalItems.map(({ trade, index }) => {
    const pnl = calcPnl(trade.risk, trade.reward, trade.result);
    if (pnl !== "") cum = round1(cum + pnl);
    return { trade, index, pnl, cum: pnl === "" ? "" : cum };
  });
  const closed = chronologicalRows.filter((row) => row.trade.result);
  const wins = closed.filter((row) => row.trade.result === "WIN");
  const losses = closed.filter((row) => row.trade.result === "LOSS");
  const bes = closed.filter((row) => row.trade.result === "BE");
  const totalPnl = round1(closed.reduce((sum, row) => sum + (parseFloat(row.pnl) || 0), 0));
  const winRate = closed.length ? wins.length / closed.length * 100 : 0;
  const grossWin = wins.reduce((sum, row) => sum + (parseFloat(row.pnl) || 0), 0);
  const grossLoss = losses.reduce((sum, row) => sum + Math.abs(parseFloat(row.pnl) || 0), 0);
  const avgWin = wins.length ? wins.reduce((sum, row) => sum + (parseFloat(row.trade.reward) || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, row) => sum + (parseFloat(row.trade.risk) || 0), 0) / losses.length : 0;
  return {
    closed,
    wins,
    losses,
    bes,
    totalPnl,
    winRate,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? grossWin : 0,
    expectancy: closed.length ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss : 0,
    rows: chronologicalRows.reverse()
  };
}

function rangeLabel(range) {
  if (!range.from && !range.to) return "All trades";
  if (range.from && range.to) return `${formatDateDisplay(range.from)} to ${formatDateDisplay(range.to)}`;
  if (range.from) return `From ${formatDateDisplay(range.from)}`;
  return `Until ${formatDateDisplay(range.to)}`;
}

function reportBadge(value, type) {
  const v = escapeHtml(value || "-");
  if (type === "entry") return `<span class="r-badge ${value === "BUY" ? "r-buy" : value === "SELL" ? "r-sell" : ""}">${v}</span>`;
  if (type === "result") return `<span class="r-badge ${value === "WIN" ? "r-win" : value === "LOSS" ? "r-loss" : value === "BE" ? "r-be" : ""}">${v}</span>`;
  return `<span class="r-badge">${v}</span>`;
}

function reportGroupRows(items, field) {
  const closed = items.filter(({ trade }) => trade.result);
  const map = new Map();
  closed.forEach(({ trade }) => {
    const key = trade[field] || "-";
    if (!map.has(key)) map.set(key, { key, trades: 0, wins: 0, losses: 0, be: 0, pnl: 0 });
    const row = map.get(key);
    row.trades += 1;
    row.wins += trade.result === "WIN" ? 1 : 0;
    row.losses += trade.result === "LOSS" ? 1 : 0;
    row.be += trade.result === "BE" ? 1 : 0;
    row.pnl = round1(row.pnl + (parseFloat(calcPnl(trade.risk, trade.reward, trade.result)) || 0));
  });
  return Array.from(map.values()).sort((a, b) => b.pnl - a.pnl);
}

function reportAnalysisTable(title, items, field) {
  const rows = reportGroupRows(items, field);
  if (!rows.length) return "";
  return `
    <section class="r-section">
      <h2>${escapeHtml(title)}</h2>
      <table class="r-table compact">
        <thead><tr><th>Name</th><th>Trades</th><th>Wins</th><th>Loss</th><th>BE</th><th>Win Rate</th><th>P&L</th></tr></thead>
        <tbody>
          ${rows.map((row) => {
            const wr = row.trades ? row.wins / row.trades * 100 : 0;
            return `<tr><td>${escapeHtml(row.key)}</td><td>${row.trades}</td><td class="r-pos">${row.wins}</td><td class="r-neg">${row.losses}</td><td>${row.be}</td><td>${wr.toFixed(0)}%</td><td class="${row.pnl >= 0 ? "r-pos" : "r-neg"}">${signed(row.pnl)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function buildReportHtml(range = reportRange()) {
  const items = tradesForRange(range);
  const p = reportPerformance(items);
  const generated = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const rows = p.rows.map(({ trade, index, pnl, cum }) => `
    <tr>
      <td>#${index + 1}</td>
      <td>${escapeHtml(formatDateDisplay(trade.date))}</td>
      <td>${escapeHtml(trade.session || "-")}</td>
      <td>${reportBadge(trade.entry, "entry")}</td>
      <td>${escapeHtml(trade.level || "-")}</td>
      <td>${escapeHtml(trade.tf || "-")}</td>
      <td>${escapeHtml(trade.setup || "-")}</td>
      <td>${escapeHtml(trade.mistake || "-")}</td>
      <td>${escapeHtml(trade.hold || "-")}</td>
      <td>${escapeHtml(trade.risk || "-")}</td>
      <td>${escapeHtml(trade.reward || "-")}</td>
      <td>${escapeHtml(calcRR(trade.risk, trade.reward) || "-")}</td>
      <td>${reportBadge(trade.result, "result")}</td>
      <td class="${moneyClass(pnl) === "pos" ? "r-pos" : moneyClass(pnl) === "neg" ? "r-neg" : ""}">${pnl === "" ? "-" : signed(pnl)}</td>
      <td>${cum === "" ? "-" : signed(cum)}</td>
      <td>${escapeHtml(trade.reason || "")}</td>
    </tr>
  `).join("");

  return `
    <div class="r-page">
      <header class="r-header">
        <div>
          <div class="r-kicker">XAUUSD Trading Journal</div>
          <h1>Trade Log & Analysis Report</h1>
          <p>${escapeHtml(rangeLabel(range))}</p>
        </div>
        <div class="r-meta">
          <b>Gold Journal</b>
          <span>Generated ${escapeHtml(generated)}</span>
        </div>
      </header>
      <section class="r-summary">
        <div><span>Closed Trades</span><b>${p.closed.length}</b></div>
        <div><span>Win Rate</span><b class="${p.winRate >= 50 ? "r-pos" : "r-neg"}">${p.winRate.toFixed(1)}%</b></div>
        <div><span>Total P&L</span><b class="${p.totalPnl >= 0 ? "r-pos" : "r-neg"}">${signed(p.totalPnl)} pips</b></div>
        <div><span>Profit Factor</span><b>${p.profitFactor.toFixed(2)}</b></div>
        <div><span>Expectancy</span><b class="${p.expectancy >= 0 ? "r-pos" : "r-neg"}">${signed(p.expectancy)} pips</b></div>
      </section>
      <section class="r-section">
        <h2>Trade Log</h2>
        <table class="r-table">
          <thead><tr><th>#</th><th>Date</th><th>Session</th><th>Side</th><th>Level</th><th>TF</th><th>Setup</th><th>Mistake</th><th>Hold</th><th>Risk</th><th>Reward</th><th>RR</th><th>Result</th><th>P&L</th><th>Cum</th><th>Notes</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="16">No trades found for this range.</td></tr>`}</tbody>
        </table>
      </section>
      <div class="r-analysis-grid">
        ${reportAnalysisTable("Session Analysis", items, "session")}
        ${reportAnalysisTable("Level Analysis", items, "level")}
        ${reportAnalysisTable("Setup Analysis", items, "setup")}
        ${reportAnalysisTable("Mistake Analysis", items, "mistake")}
      </div>
    </div>
  `;
}

function renderWeeklyReviews() {
  const weekInput = document.getElementById("review-week");
  if (weekInput && !weekInput.value) weekInput.value = todayISO();
  const list = document.getElementById("weekly-review-list");
  const count = document.getElementById("review-count");
  if (count) count.textContent = `${state.weeklyReviews.length} saved`;
  if (!list) return;
  const reviews = state.weeklyReviews.slice().sort((a, b) => String(b.weekOf).localeCompare(String(a.weekOf)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!reviews.length) {
    list.innerHTML = `<div class="empty-state"><div><strong>No weekly reviews yet</strong><span>Save your first review to build a feedback loop.</span></div></div>`;
    refreshIcons();
    return;
  }
  list.innerHTML = reviews.map((review) => `
    <article class="weekly-card">
      <button class="icon-btn" onclick="deleteWeeklyReview('${escapeHtml(review.id)}')" title="Delete review"><i data-lucide="trash-2"></i></button>
      <h3>${escapeHtml(formatDateDisplay(review.weekOf) || review.weekOf)}</h3>
      <div><span>What did I learn this week?</span><p>${escapeHtml(review.learned || "-")}</p></div>
      <div><span>What pattern repeated (good or bad)?</span><p>${escapeHtml(review.pattern || "-")}</p></div>
      <div><span>What will I improve next week?</span><p>${escapeHtml(review.improve || "-")}</p></div>
    </article>
  `).join("");
  refreshIcons();
}

function saveWeeklyReview() {
  const review = normalizeWeeklyReview({
    weekOf: document.getElementById("review-week")?.value || todayISO(),
    learned: document.getElementById("review-learned")?.value.trim() || "",
    pattern: document.getElementById("review-pattern")?.value.trim() || "",
    improve: document.getElementById("review-improve")?.value.trim() || "",
    createdAt: new Date().toISOString()
  });
  state.weeklyReviews.push(review);
  save();
  ["review-learned", "review-pattern", "review-improve"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderWeeklyReviews();
  toast("Weekly review saved.");
}

function deleteWeeklyReview(id) {
  state.weeklyReviews = state.weeklyReviews.filter((review) => review.id !== id);
  save();
  renderWeeklyReviews();
  toast("Weekly review deleted.");
}

function renderManage() {
  const grid = document.getElementById("manage-grid");
  if (!grid) return;
  grid.innerHTML = Object.keys(CAT_META).map((cat) => `
    <div class="manage-card">
      <h3>${escapeHtml(CAT_META[cat].label)}</h3>
      <div class="tag-list" id="tags-${cat}"></div>
      <div class="add-row">
        <input id="inp-${cat}" type="text" placeholder="Add new item" onkeydown="if(event.key === 'Enter') addOption('${cat}')">
        <button onclick="addOption('${cat}')">Add</button>
      </div>
    </div>
  `).join("");
  Object.keys(CAT_META).forEach(renderTags);
  refreshIcons();
}

function renderTags(cat) {
  const el = document.getElementById(`tags-${cat}`);
  if (!el) return;
  el.innerHTML = (state.options[cat] || []).map((item, index) => {
    const fixed = (FIXED[cat] || []).includes(item);
    const btn = fixed ? "" : `<button title="Remove" onclick="removeOption('${cat}', ${index})">x</button>`;
    return `<span class="tag">${escapeHtml(item)}${btn}</span>`;
  }).join("");
}

function addOption(cat) {
  const input = document.getElementById(`inp-${cat}`);
  const value = input?.value.trim();
  if (!value) return;
  if (!state.options[cat]) state.options[cat] = [];
  if (state.options[cat].includes(value)) {
    input.value = "";
    toast("Option already exists.");
    return;
  }
  state.options[cat].push(value);
  input.value = "";
  save();
  renderManage();
  renderFilters();
  renderTrades();
  toast("Option added.");
}

function removeOption(cat, index) {
  const item = state.options[cat]?.[index];
  if (!item || (FIXED[cat] || []).includes(item)) return;
  state.options[cat].splice(index, 1);
  save();
  renderManage();
  renderFilters();
  renderTrades();
  toast("Option removed.");
}

function resetOptions() {
  state.options = clone(FIXED);
  save();
  renderManage();
  renderFilters();
  renderTrades();
  toast("Options reset to default.");
}

function switchTab(name, button) {
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  if (button) button.classList.add("active");
  document.getElementById(`tab-${name}`)?.classList.add("active");
  if (name === "analysis") renderAnalysis();
  if (name === "pnl") renderPnl();
  if (name === "weekly") renderWeeklyReviews();
  if (name === "manage") renderManage();
  refreshIcons();
}

function exportRows() {
  recalcCum();
  const headers = ["#", "Date", "Session", "Side", "Level", "TF", "Setup", "Mistake", "Hold", "Risk(pips)", "Reward(pips)", "RR", "Result", "P&L(pips)", "Cumul P&L", "Notes"];
  const rows = state.trades.map((trade, index) => ({ trade, index })).reverse().map(({ trade, index }) => [
    index + 1,
    formatDateDisplay(trade.date),
    trade.session,
    trade.entry,
    trade.level,
    trade.tf,
    trade.setup,
    trade.mistake,
    trade.hold,
    trade.risk,
    trade.reward,
    calcRR(trade.risk, trade.reward),
    trade.result,
    trade.pnl,
    trade.cum,
    trade.reason || ""
  ]);
  return { headers, rows };
}

function exportCSV() {
  const { headers, rows } = exportRows();
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  download(`data:text/csv;charset=utf-8,\uFEFF${encodeURIComponent(csv)}`, "Gold_Journal.csv");
}

function exportExcel() {
  if (typeof XLSX === "undefined") {
    alert("XLSX library is not loaded. Please reload the page.");
    return;
  }
  const { headers, rows } = exportRows();
  const wb = XLSX.utils.book_new();
  const wsTrades = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsTrades["!cols"] = [4, 12, 24, 8, 14, 8, 12, 18, 18, 10, 12, 9, 9, 10, 12, 34].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsTrades, "Trade Log");

  const p = performance();
  const summary = [
    ["Metric", "Value"],
    ["Closed Trades", p.closed.length],
    ["Wins", p.wins.length],
    ["Losses", p.losses.length],
    ["Break Even", p.bes.length],
    ["Win Rate %", +p.winRate.toFixed(1)],
    ["Total P&L", +p.totalPnl.toFixed(1)],
    ["Profit Factor", +p.profitFactor.toFixed(2)],
    ["Expectancy", +p.expectancy.toFixed(1)],
    ["Max Drawdown", +p.maxDrawdown.toFixed(1)]
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary["!cols"] = [{ wch: 22 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  XLSX.writeFile(wb, "Gold_Trading_Journal.xlsx");
}

function exportPDF() {
  const range = reportRange();
  const report = document.getElementById("print-report");
  if (!report) return;
  report.innerHTML = buildReportHtml(range);
  const title = document.title;
  document.title = `Gold_Trading_Journal_${range.from || "all"}_${range.to || "trades"}`;
  document.body.classList.add("printing-report");
  window.print();
  setTimeout(() => {
    document.title = title;
    document.body.classList.remove("printing-report");
    report.innerHTML = "";
  }, 700);
}

function download(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function seedDemoTrades() {
  if (state.trades.length && !confirm("Demo trades will be added to your current journal. Continue?")) return;
  const samples = [
    ["London (11am-2pm)", "BUY", "RBS/TJL1", "5m", "A+", "No mistake", "Held full TP", 22, 60, "WIN", "Clean retest after London sweep."],
    ["New York (5pm-8pm)", "SELL", "QML", "15m", "A", "Early entry", "Early exit", 28, 52, "LOSS", "Entered before confirmation candle."],
    ["Post-London (2pm-4pm)", "BUY", "FIB", "5m", "B", "Fear exit", "Early exit", 18, 30, "BE", "Moved stop after hesitation."],
    ["London (11am-2pm)", "SELL", "SBR/TJL1", "1m", "A+", "No mistake", "Partial + runner", 20, 75, "WIN", "Strong rejection from marked level."],
    ["Asian (5am-8am)", "BUY", "LVL2", "5m", "B", "FOMO trade", "Early exit", 16, 24, "LOSS", "Low-volume entry without structure."]
  ];
  const today = new Date();
  samples.forEach((sample, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (samples.length - i));
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    state.trades.push(normalizeTrade({
      date: d.toISOString().slice(0, 10),
      session: sample[0],
      entry: sample[1],
      level: sample[2],
      tf: sample[3],
      setup: sample[4],
      mistake: sample[5],
      hold: sample[6],
      risk: sample[7],
      reward: sample[8],
      result: sample[9],
      reason: sample[10]
    }));
  });
  save();
  renderFilters();
  renderTrades();
  renderAnalysis();
  toast("Demo trades added.");
}

if (typeof document !== "undefined") {
  loadState();
  applyReportPreset();
  renderFilters();
  renderTrades();
  renderSummary();
  refreshIcons();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("trade-modal")?.hidden) closeTradeModal();
  });
  document.getElementById("trade-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "trade-modal") closeTradeModal();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker registration failed", error));
  }
}

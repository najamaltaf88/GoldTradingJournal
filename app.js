const FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  databaseURL: ""
};

function hasFirebaseConfig() {
  return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.appId);
}

const KEY = "xau_journal_v6";
const LEGACY_KEY = "xau_journal_v5";
const SKIPPED_KEY = "skippedTrades";
const ACCOUNTS_KEY = "xau_journal_accounts_v1";
const DEFAULT_ACCOUNT_ID = "main";

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
  slTpPlacements: ["Above/Below Structure", "Fixed $", "ATR Based", "Arbitrary"],
  skipReasons: [
    "Fear - H1/15m too slow",
    "Fear - SL looked too big",
    "No confirmation candle",
    "Wrong session timing",
    "Already missed entry",
    "Distracted / not at screen",
    "Low confidence in level",
    "Other"
  ],
  skipOutcomes: ["TP Hit - Full", "TP Hit - Partial", "SL Would Have Hit", "No Reaction", "Still Playing"]
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
  slTpPlacements: { label: "SL/TP Placement" },
  skipReasons: { label: "Skipped Trade Reasons" },
  skipOutcomes: { label: "Skipped Trade Outcomes" }
};

const DATE_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SKIP_REASONS = FIXED.skipReasons;
const SKIP_OUTCOMES = FIXED.skipOutcomes;

let state = emptyJournalState();
let accounts = [];
let accountData = {};
let activeAccountId = DEFAULT_ACCOUNT_ID;

let pnlView = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: todayISO()
};

let modalEditingIndex = null;
let skippedEditingIndex = null;
let analysisTimer = null;
let currentUser = null;
let firebaseReady = false;
let firestoreLoadComplete = false;

const uiState = {
  optionalColumns: true,
  comboMinTrades: 2
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyJournalState(ownerUid = "") {
  return {
    ownerUid,
    trades: [],
    skippedTrades: [],
    options: clone(FIXED),
    settings: { defaultRisk: "" },
    weeklyReviews: []
  };
}

function defaultAccount() {
  return {
    id: DEFAULT_ACCOUNT_ID,
    name: "Main Account",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeAccount(account = {}) {
  const fallback = defaultAccount();
  return {
    id: account.id || fallback.id,
    name: String(account.name || account.label || fallback.name).trim() || fallback.name,
    createdAt: account.createdAt || fallback.createdAt,
    updatedAt: account.updatedAt || new Date().toISOString()
  };
}

function normalizeJournalState(data = {}) {
  return {
    ownerUid: currentUser?.uid || data.ownerUid || "",
    trades: Array.isArray(data.trades) ? data.trades.map(normalizeTrade) : [],
    skippedTrades: Array.isArray(data.skippedTrades) ? data.skippedTrades.map(normalizeSkippedTrade) : [],
    options: normalizeOptions(data.options || FIXED),
    settings: Object.assign({ defaultRisk: "" }, data.settings || {}),
    weeklyReviews: Array.isArray(data.weeklyReviews) ? data.weeklyReviews.map(normalizeWeeklyReview) : []
  };
}

function activeAccount() {
  return accounts.find((account) => account.id === activeAccountId) || accounts[0] || defaultAccount();
}

function ensureAccountState() {
  if (!accounts.length) accounts = [defaultAccount()];
  if (!accounts.some((account) => account.id === activeAccountId)) activeAccountId = accounts[0].id;
  if (!accountData[activeAccountId]) accountData[activeAccountId] = emptyJournalState();
  state = normalizeJournalState(accountData[activeAccountId]);
}

function journalRowCount(data = {}) {
  return (data.trades?.length || 0) + (data.skippedTrades?.length || 0) + (data.weeklyReviews?.length || 0);
}

function mergeRows(localRows = [], cloudRows = []) {
  const map = new Map();
  [...localRows, ...cloudRows].forEach((row) => {
    if (!row?.id) return;
    map.set(row.id, row);
  });
  return Array.from(map.values());
}

function mergeJournalStates(base = {}, incoming = {}) {
  const baseState = normalizeJournalState(base);
  const incomingState = normalizeJournalState(incoming);
  return normalizeJournalState({
    ownerUid: incomingState.ownerUid || baseState.ownerUid,
    trades: mergeRows(baseState.trades, incomingState.trades),
    skippedTrades: mergeRows(baseState.skippedTrades, incomingState.skippedTrades),
    weeklyReviews: mergeRows(baseState.weeklyReviews, incomingState.weeklyReviews),
    options: mergeOptions(baseState.options, incomingState.options),
    settings: Object.assign({}, baseState.settings, incomingState.settings)
  });
}

function mergeOptions(baseOptions = {}, incomingOptions = {}) {
  const merged = clone(FIXED);
  Object.keys(FIXED).forEach((key) => {
    merged[key] = Array.from(new Set([...(baseOptions[key] || []), ...(incomingOptions[key] || [])].filter(Boolean)));
  });
  return normalizeOptions(merged);
}

function loadState() {
  const accountStore = loadAccountStore();
  if (accountStore) {
    accounts = accountStore.accounts;
    accountData = accountStore.data;
    activeAccountId = accountStore.activeAccountId;
    ensureAccountState();
    return;
  }

  const savedSkippedTrades = loadSkippedTradesFromLocal();
  const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
  accounts = [defaultAccount()];
  accountData = {};
  activeAccountId = DEFAULT_ACCOUNT_ID;
  if (!raw) {
    state = emptyJournalState();
    state.skippedTrades = savedSkippedTrades;
    accountData[activeAccountId] = clone(state);
    persistLocalState();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.trades)) {
      state = emptyJournalState();
      state.skippedTrades = savedSkippedTrades;
      accountData[activeAccountId] = clone(state);
      persistLocalState();
      return;
    }
    if (currentUser && parsed.ownerUid && parsed.ownerUid !== currentUser.uid) {
      state = emptyJournalState(currentUser.uid);
      accountData[activeAccountId] = clone(state);
      persistLocalState();
      return;
    }
    state = normalizeJournalState({
      ...parsed,
      skippedTrades: savedSkippedTrades.length ? savedSkippedTrades : parsed.skippedTrades
    });
    accountData[activeAccountId] = clone(state);
    persistLocalState();
  } catch (error) {
    console.warn("Could not load journal state", error);
  }
}

function loadAccountStore() {
  const raw = localStorage.getItem(ACCOUNTS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.accounts) || !parsed.data) return null;
    if (currentUser && parsed.ownerUid && parsed.ownerUid !== currentUser.uid) return null;
    const normalizedAccounts = parsed.accounts.map(normalizeAccount).filter((account) => account.id);
    const nextAccounts = normalizedAccounts.length ? normalizedAccounts : [defaultAccount()];
    const nextData = {};
    nextAccounts.forEach((account) => {
      nextData[account.id] = normalizeJournalState(parsed.data[account.id] || {});
    });
    const selected = nextAccounts.some((account) => account.id === parsed.activeAccountId) ? parsed.activeAccountId : nextAccounts[0].id;
    return { accounts: nextAccounts, data: nextData, activeAccountId: selected };
  } catch (error) {
    console.warn("Could not load account store", error);
    return null;
  }
}

function loadSkippedTradesFromLocal() {
  const raw = localStorage.getItem(SKIPPED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeSkippedTrade) : [];
  } catch (error) {
    console.warn("Could not load skipped trades", error);
    return [];
  }
}

function persistLocalState() {
  if (currentUser) state.ownerUid = currentUser.uid;
  state = normalizeJournalState(state);
  if (!accounts.length) accounts = [defaultAccount()];
  if (!accounts.some((account) => account.id === activeAccountId)) activeAccountId = accounts[0].id;
  accountData[activeAccountId] = clone(state);
  const store = {
    ownerUid: currentUser?.uid || state.ownerUid || "",
    activeAccountId,
    accounts,
    data: accountData
  };
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(store));
  localStorage.setItem(KEY, JSON.stringify(state));
  localStorage.setItem(SKIPPED_KEY, JSON.stringify(state.skippedTrades));
}

function normalizeOptions(options) {
  const next = clone(FIXED);
  Object.keys(FIXED).forEach((key) => {
    const custom = Array.isArray(options[key]) ? options[key].map(normalizeUnitLabel) : [];
    next[key] = Array.from(new Set([...FIXED[key], ...custom].filter(Boolean)));
  });
  return next;
}

function normalizeUnitLabel(value) {
  return String(value || "").replace(/\bpips\b/gi, "$");
}

function normalizeTrade(trade) {
  return {
    id: trade.id || generateId("trade"),
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
    slTpPlacement: normalizeUnitLabel(trade.slTpPlacement || ""),
    patienceScore: normalizePatienceScore(trade.patienceScore),
    risk: trade.risk || "",
    reward: trade.reward || "",
    result: trade.result || "",
    reason: trade.reason || trade.notes || "",
    pnl: trade.pnl ?? "",
    cum: trade.cum ?? ""
  };
}

function normalizeSkippedTrade(trade = {}) {
  return {
    id: trade.id || generateId("skipped"),
    date: trade.date || "",
    session: trade.session || "",
    level: trade.level || "",
    tf: trade.tf || "",
    direction: trade.direction || trade.entry || "",
    skipReason: normalizeDashValue(trade.skipReason || trade.reason || ""),
    confidence: normalizeConfidence(trade.confidence),
    notes: trade.notes || "",
    outcome: normalizeDashValue(trade.outcome || ""),
    pipsMissed: trade.pipsMissed ?? ""
  };
}

function normalizeDashValue(value) {
  return String(value || "").replace(/\s+\u2014\s+/g, " - ");
}

function normalizePatienceScore(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return "";
  return String(Math.min(5, Math.max(1, n)));
}

function normalizeConfidence(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return "";
  return String(Math.min(5, Math.max(1, n)));
}

function normalizeWeeklyReview(review) {
  return {
    id: review.id || generateId("review"),
    weekOf: review.weekOf || "",
    learned: review.learned || "",
    pattern: review.pattern || "",
    improve: review.improve || "",
    createdAt: review.createdAt || new Date().toISOString()
  };
}

async function save() {
  try {
    persistLocalState();
    renderAccountSelector();
  } catch (error) {
    console.warn("Could not save journal state", error);
    updateSyncStatus("offline");
  }

  if (currentUser && firestoreLoadComplete) {
    try {
      await saveToFirestore();
    } catch (error) {
      console.warn("Could not sync to Firestore", error);
      updateSyncStatus("offline");
    }
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
  const hour = new Date().getUTCHours();
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
  const bestLevel = bestLevelByPnl();
  const strip = document.getElementById("summary-strip");
  if (strip) {
    strip.innerHTML = [
      metric("Closed Trades", p.closed.length, `${open} open`),
      metric("Win Rate", `${p.winRate.toFixed(1)}%`, `${p.wins.length}W / ${p.losses.length}L`, p.winRate >= 50 ? "pos" : "neg"),
      metric("Total P&L", `${signed(p.totalPnl)} $`, "auto calculated", moneyClass(p.totalPnl)),
      metric("Profit Factor", p.profitFactor.toFixed(2), p.profitFactor >= 1 ? "Healthy" : "Needs work", p.profitFactor >= 1 ? "pos" : "neg"),
      metric("Expectancy", `${signed(p.expectancy)} $`, "per closed trade", moneyClass(p.expectancy))
    ].join("");
  }

  const sidebar = document.getElementById("sidebar-stats");
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="stat-row"><span class="stat-label">Trades</span><span class="stat-val gold">${p.closed.length}</span></div>
      <div class="stat-row"><span class="stat-label">Win Rate</span><span class="stat-val ${p.winRate >= 50 ? "pos" : "neg"}">${p.winRate.toFixed(0)}%</span></div>
      <div class="stat-row"><span class="stat-label">Total P&L</span><span class="stat-val ${moneyClass(p.totalPnl)}">${signed(p.totalPnl)}</span></div>
      <div class="stat-row"><span class="stat-label">Drawdown</span><span class="stat-val ${p.maxDrawdown < 0 ? "neg" : "neutral"}">${signed(p.maxDrawdown)}</span></div>
      <div class="stat-row"><span class="stat-label">Best Level</span><span class="stat-val gold">${escapeHtml(bestLevel || "-")}</span></div>
    `;
  }

  const sub = document.getElementById("log-sub");
  if (sub) {
    sub.textContent = `${state.trades.length} trades saved, ${p.closed.length} closed, ${p.winRate.toFixed(0)}% win rate.`;
  }
}

function renderAccountSelector() {
  const select = document.getElementById("account-select");
  if (!select) return;
  const current = select.value || activeAccountId;
  select.innerHTML = accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join("");
  select.value = accounts.some((account) => account.id === activeAccountId) ? activeAccountId : current;
}

function renderCurrentAccount() {
  renderAccountSelector();
  renderFilters();
  renderTrades();
  renderSkippedTrades();
  renderSummary();
  if (document.getElementById("tab-analysis")?.classList.contains("active")) renderAnalysisWithDelay();
  if (document.getElementById("tab-pnl")?.classList.contains("active")) renderPnl();
  if (document.getElementById("tab-weekly")?.classList.contains("active")) renderWeeklyReviews();
  if (document.getElementById("tab-manage")?.classList.contains("active")) renderManage();
  refreshIcons();
}

async function addAccount() {
  const name = prompt("New account name:")?.trim();
  if (!name) return;
  const account = normalizeAccount({
    id: generateId("account"),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  accounts.push(account);
  activeAccountId = account.id;
  state = emptyJournalState();
  accountData[activeAccountId] = clone(state);
  try {
    persistLocalState();
    if (currentUser && firestoreLoadComplete) await saveToFirestore();
  } catch (error) {
    console.warn("Could not save account", error);
    updateSyncStatus("offline");
  }
  renderCurrentAccount();
  toast("Account added.");
}

async function renameAccount() {
  const account = activeAccount();
  const name = prompt("Account name:", account.name)?.trim();
  if (!name || name === account.name) return;
  account.name = name;
  account.updatedAt = new Date().toISOString();
  try {
    persistLocalState();
    if (currentUser && firestoreLoadComplete) await saveToFirestore();
    renderCurrentAccount();
    toast("Account renamed.");
  } catch (error) {
    console.warn("Could not rename account", error);
    updateSyncStatus("offline");
    toast("Account rename failed.");
  }
}

async function switchAccount(accountId) {
  if (!accountId || accountId === activeAccountId) return;
  const nextAccount = accounts.find((account) => account.id === accountId);
  if (!nextAccount) return;
  try {
    await save();
    activeAccountId = accountId;
    state = normalizeJournalState(accountData[activeAccountId] || emptyJournalState());
    persistLocalState();
    renderCurrentAccount();
    if (currentUser && firestoreLoadComplete) {
      await loadAccountFromFirestore(currentUser.uid, activeAccountId);
      persistLocalState();
      renderCurrentAccount();
    }
    toast(`${nextAccount.name} loaded.`);
  } catch (error) {
    console.warn("Could not switch account", error);
    updateSyncStatus("offline");
    toast("Account switch failed.");
  }
}

function bestLevelByPnl() {
  const p = performance();
  const map = new Map();
  p.closed.forEach((trade) => {
    const key = trade.level || "-";
    map.set(key, round1((map.get(key) || 0) + (parseFloat(trade.pnl) || 0)));
  });
  const rows = Array.from(map.entries()).filter(([, pnl]) => pnl !== 0);
  if (!rows.length) return "";
  return rows.sort((a, b) => b[1] - a[1])[0][0];
}

function metric(label, value, note, cls = "") {
  const cardClass = cls ? ` metric-${cls}` : "";
  return `
    <div class="metric-card${cardClass}">
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
  fillFilter("missed-reason-filter", state.options.skipReasons || SKIP_REASONS, "All reasons");
}

function clearFilters() {
  ["search-input", "result-filter", "session-filter", "setup-filter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderTrades();
}

function toggleOptionalColumns() {
  uiState.optionalColumns = !uiState.optionalColumns;
  updateColumnToggle();
}

function updateColumnToggle() {
  document.body.classList.toggle("show-optional-columns", uiState.optionalColumns);
  const button = document.getElementById("column-toggle");
  if (!button) return;
  button.innerHTML = `<i data-lucide="columns-3"></i><span>${uiState.optionalColumns ? "Hide Columns" : "Show Columns"}</span>`;
  refreshIcons();
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

function hasActiveTradeFilters() {
  return ["search-input", "result-filter", "session-filter", "setup-filter"].some((id) => {
    const el = document.getElementById(id);
    return Boolean(el && String(el.value || "").trim());
  });
}

function renderTrades() {
  recalcCum();
  renderSummary();
  updateColumnToggle();
  const tbody = document.getElementById("trade-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = filteredTrades();
  if (!state.trades.length) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="22">
          <div class="empty-state onboarding-state">
            <div class="onboarding-card">
              <i data-lucide="clipboard-plus"></i>
              <strong>Start your first trade</strong>
              <span>Click New Trade, fill the form, and your analysis updates automatically. No spreadsheet needed.</span>
              <div class="onboarding-actions">
                <button class="primary-btn" onclick="addTrade()"><i data-lucide="plus"></i><span>New Trade</span></button>
                <button class="soft-btn" onclick="seedDemoTrades()"><i data-lucide="sparkles"></i><span>Or load demo data to explore the app</span></button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
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
    tr.classList.add("clickable-row");
    tr.addEventListener("click", (event) => {
      if (event.target.closest("button, input, select, textarea, a")) return;
      openTradeModal(index);
    });
    tr.appendChild(textCell("#", index + 1, "row-num"));
    tr.appendChild(displayCell("Date", formatDateDisplay(trade.date) || "-", "date-display"));
    tr.appendChild(displayCell("Session", trade.session || "-", "wrap-text"));
    tr.appendChild(htmlCell("Side", valuePill(trade.entry, "entry")));
    tr.appendChild(displayCell("Level", trade.level || "-", "wrap-text"));
    tr.appendChild(displayCell("TF", trade.tf || "-", "mono"));
    tr.appendChild(htmlCell("Setup", valuePill(trade.setup, "setup")));
    tr.appendChild(displayCell("Mistake", trade.mistake || "-", "wrap-text"));
    tr.appendChild(displayCell("Hold", trade.hold || "-", "wrap-text"));
    tr.appendChild(displayCell("Market", trade.marketCondition || "-", "wrap-text optional-col"));
    tr.appendChild(displayCell("Bias", trade.biasAlignment || "-", "wrap-text optional-col"));
    tr.appendChild(displayCell("Confirm", trade.confirmationType || "-", "wrap-text optional-col"));
    tr.appendChild(displayCell("SL/TP", trade.slTpPlacement || "-", "wrap-text optional-col"));
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
    id: generateId("trade"),
    date: todayISO(),
    session: base.session || currentSession(),
    mistake: base.mistake || "No mistake",
    risk: base.risk || state.settings.defaultRisk || "",
    result: source ? "" : base.result || "",
    patienceScore: source ? "" : base.patienceScore || "",
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
  if (document.getElementById("tab-missed")?.classList.contains("active")) renderSkippedTrades();
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
    trade.id = state.trades[modalEditingIndex]?.id || trade.id || generateId("trade");
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

function skippedTradeTemplate() {
  return normalizeSkippedTrade({
    date: todayISO(),
    session: currentSession()
  });
}

function addSkippedTrade() {
  openSkippedModal();
}

function openSkippedModal(index = null) {
  skippedEditingIndex = Number.isInteger(index) ? index : null;
  fillModalSelect("skipped-session", state.options.sessions, "Select", "sessions");
  fillModalSelect("skipped-level", state.options.levels, "Select", "levels");
  fillModalSelect("skipped-tf", state.options.tfs, "Select", "tfs");
  fillModalSelect("skipped-reason", state.options.skipReasons || SKIP_REASONS, "Select", "skipReasons");
  fillModalSelect("skipped-outcome", state.options.skipOutcomes || SKIP_OUTCOMES, "Select", "skipOutcomes");

  const trade = skippedEditingIndex === null ? skippedTradeTemplate() : state.skippedTrades[skippedEditingIndex];
  const title = document.getElementById("skipped-modal-title");
  if (title) title.textContent = skippedEditingIndex === null ? "LOG_SKIPPED_TRADE" : `EDIT_SKIPPED_TRADE #${skippedEditingIndex + 1}`;
  setModalValue("skipped-date", trade.date || todayISO());
  setModalValue("skipped-session", trade.session);
  setModalValue("skipped-level", trade.level);
  setModalValue("skipped-tf", trade.tf);
  setModalValue("skipped-direction", trade.direction);
  setModalValue("skipped-reason", trade.skipReason);
  setModalValue("skipped-confidence", trade.confidence);
  setModalValue("skipped-notes", trade.notes);
  setModalValue("skipped-outcome", trade.outcome);
  setModalValue("skipped-pips-missed", trade.pipsMissed);

  const modal = document.getElementById("skipped-modal");
  if (modal) {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => document.getElementById("skipped-date")?.focus(), 40);
  }
  refreshIcons();
}

function closeSkippedModal() {
  const modal = document.getElementById("skipped-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("modal-open");
  skippedEditingIndex = null;
}

function modalSkippedTradeData() {
  return normalizeSkippedTrade({
    date: document.getElementById("skipped-date")?.value || todayISO(),
    session: document.getElementById("skipped-session")?.value || "",
    level: document.getElementById("skipped-level")?.value || "",
    tf: document.getElementById("skipped-tf")?.value || "",
    direction: document.getElementById("skipped-direction")?.value || "",
    skipReason: document.getElementById("skipped-reason")?.value || "",
    confidence: normalizeConfidence(document.getElementById("skipped-confidence")?.value || ""),
    notes: document.getElementById("skipped-notes")?.value || "",
    outcome: document.getElementById("skipped-outcome")?.value || "",
    pipsMissed: document.getElementById("skipped-pips-missed")?.value || ""
  });
}

function saveSkippedTradeFromModal() {
  const skippedTrade = modalSkippedTradeData();
  if (!skippedTrade.date) {
    toast("Date required.");
    return;
  }
  const isEdit = skippedEditingIndex !== null;
  if (skippedEditingIndex === null) {
    state.skippedTrades.push(skippedTrade);
  } else {
    skippedTrade.id = state.skippedTrades[skippedEditingIndex]?.id || skippedTrade.id || generateId("skipped");
    state.skippedTrades[skippedEditingIndex] = skippedTrade;
  }
  save();
  renderSkippedTrades();
  closeSkippedModal();
  toast(isEdit ? "Skipped trade updated." : "Skipped trade saved.");
}

function deleteSkippedTrade(index) {
  state.skippedTrades.splice(index, 1);
  save();
  renderSkippedTrades();
  toast("Skipped trade deleted.");
}

function clearSkippedFilters() {
  ["missed-outcome-filter", "missed-reason-filter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderSkippedTrades();
}

function skippedStats(trades = state.skippedTrades) {
  const wins = trades.filter((trade) => isSkippedWin(trade.outcome));
  const losses = trades.filter((trade) => trade.outcome === "SL Would Have Hit");
  const reasonCounts = new Map();
  trades.forEach((trade) => {
    const reason = trade.skipReason || "-";
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  });
  const mostCommonReason = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "-";
  const decided = wins.length + losses.length;
  const winRate = decided ? wins.length / decided * 100 : 0;
  const winningPips = wins.map((trade) => parseFloat(trade.pipsMissed)).filter((value) => Number.isFinite(value));
  const avgPipsMissed = winningPips.length ? winningPips.reduce((sum, value) => sum + value, 0) / winningPips.length : 0;
  return { total: trades.length, wins, losses, mostCommonReason, winRate, avgPipsMissed };
}

function isSkippedWin(outcome) {
  const normalized = normalizeDashValue(outcome);
  return normalized === "TP Hit - Full" || normalized === "TP Hit - Partial";
}

function optionalDisplay(value) {
  return value === "" || value === null || value === undefined ? "-" : value;
}

function filteredSkippedTrades() {
  const outcome = document.getElementById("missed-outcome-filter")?.value || "";
  const reason = document.getElementById("missed-reason-filter")?.value || "";
  return state.skippedTrades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => {
      if (reason && trade.skipReason !== reason) return false;
      if (outcome === "tp" && !isSkippedWin(trade.outcome)) return false;
      if (outcome === "sl" && trade.outcome !== "SL Would Have Hit") return false;
      if (outcome === "no-reaction" && trade.outcome !== "No Reaction") return false;
      return true;
    })
    .reverse();
}

function renderSkippedSummary() {
  const stats = skippedStats();
  const strip = document.getElementById("missed-summary-strip");
  if (!strip) return;
  strip.innerHTML = [
    metric("Total Skipped", stats.total, "opportunities logged"),
    metric("Would Win", stats.wins.length, "TP full + partial", stats.wins.length ? "pos" : "neutral"),
    metric("Would Lose", stats.losses.length, "SL would have hit", stats.losses.length ? "neg" : "neutral"),
    metric("Top Reason", stats.mostCommonReason, "most common skip"),
    metric("Skipped Win Rate", `${stats.winRate.toFixed(1)}%`, "TP vs SL outcomes", stats.winRate >= 50 ? "pos" : "neg"),
    metric("Avg $ Missed", `${stats.avgPipsMissed.toFixed(1)} $`, "winning skips", stats.avgPipsMissed ? "pos" : "neutral")
  ].join("");
}

function renderSkippedTrades() {
  renderSkippedSummary();
  const tbody = document.getElementById("missed-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = filteredSkippedTrades();
  if (!state.skippedTrades.length) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="11">
          <div class="empty-state onboarding-state">
            <div class="onboarding-card">
              <i data-lucide="crosshair"></i>
              <strong>Log skipped setups</strong>
              <span>Track the XAUUSD opportunities you passed on and review what happened next.</span>
              <div class="onboarding-actions">
                <button class="primary-btn" onclick="addSkippedTrade()"><i data-lucide="plus"></i><span>Log Skipped Trade</span></button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
    refreshIcons();
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div><strong>No matching skipped trades</strong><span>Clear filters to see all skipped trades.</span></div></div></td></tr>`;
    refreshIcons();
    return;
  }

  rows.forEach(({ trade, index }) => {
    const tr = document.createElement("tr");
    tr.className = isSkippedWin(trade.outcome) ? "row-win" : trade.outcome === "SL Would Have Hit" ? "row-loss" : "";
    tr.classList.add("clickable-row");
    tr.addEventListener("click", (event) => {
      if (event.target.closest("button, input, select, textarea, a")) return;
      openSkippedModal(index);
    });
    tr.appendChild(displayCell("Date", formatDateDisplay(trade.date) || "-", "date-display"));
    tr.appendChild(displayCell("Session", trade.session || "-", "wrap-text"));
    tr.appendChild(displayCell("Level", trade.level || "-", "wrap-text"));
    tr.appendChild(displayCell("TF", trade.tf || "-", "mono"));
    tr.appendChild(htmlCell("Direction", valuePill(trade.direction, "entry")));
    tr.appendChild(displayCell("Skip Reason", trade.skipReason || "-", "wrap-text"));
    tr.appendChild(displayCell("Confidence", trade.confidence ? `${trade.confidence}/5` : "-", "mono"));
    tr.appendChild(htmlCell("Outcome", valuePill(trade.outcome, "result")));
    tr.appendChild(displayCell("$ Missed", optionalDisplay(trade.pipsMissed), "mono"));
    tr.appendChild(displayCell("Notes", trade.notes || "-", "notes-preview"));
    tr.appendChild(skippedActionCell("Actions", index));
    tbody.appendChild(tr);
  });

  refreshIcons();
}

function skippedActionCell(label, index) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.className = "action-cell";
  const edit = document.createElement("button");
  edit.className = "icon-btn";
  edit.title = "Edit skipped trade";
  edit.innerHTML = `<i data-lucide="pencil"></i>`;
  edit.addEventListener("click", () => openSkippedModal(index));
  const del = document.createElement("button");
  del.className = "icon-btn";
  del.title = "Delete skipped trade";
  del.innerHTML = `<i data-lucide="trash-2"></i>`;
  del.addEventListener("click", () => deleteSkippedTrade(index));
  td.appendChild(edit);
  td.appendChild(del);
  return td;
}

function scrollToLastRow() {
  setTimeout(() => {
    const shell = document.querySelector("#tab-log .table-shell");
    if (shell) shell.scrollTo({ top: 0, behavior: "smooth" });
    if (hasActiveTradeFilters()) return;
    document.querySelector("#trade-body tr")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, 40);
}

function showAnalysisSkeleton() {
  const el = document.getElementById("analysis-content");
  if (!el) return;
  el.innerHTML = `
    <div class="analysis-skeleton" aria-label="Loading analysis">
      <div></div>
      <div></div>
      <div></div>
    </div>
  `;
}

function renderAnalysisWithDelay() {
  clearTimeout(analysisTimer);
  showAnalysisSkeleton();
  analysisTimer = setTimeout(renderAnalysis, 200);
}

function renderAnalysis() {
  const el = document.getElementById("analysis-content");
  if (!el) return;
  const p = performance();
  const streaks = streakStats();
  el.innerHTML = `
    <div class="analysis-automation">
      <div>
        <span class="auto-chip">Auto Analysis Engine</span>
        <h2>Performance Command Center</h2>
        <p>Live edge scanner across levels, sessions, confirmations, risk, and result quality.</p>
      </div>
      <div class="auto-pulse">
        <span>${p.winRate.toFixed(1)}%</span>
        <small>WIN RATE</small>
      </div>
    </div>
    <div class="dashboard-strip analysis-strip">
      ${metric("Total Trades", p.closed.length, `${state.trades.length - p.closed.length} open`)}
      ${metric("Wins", p.wins.length, "closed winners", "pos")}
      ${metric("Losses", p.losses.length, "closed losses", "neg")}
      ${metric("Avg Win", `${p.avgWin.toFixed(1)} $`, "winning trades", "pos")}
      ${metric("Avg Loss", `${p.avgLoss.toFixed(1)} $`, "losing trades", "neg")}
    </div>
    <div class="dashboard-strip analysis-strip">
      ${metric("Current Win Streak", streaks.currentWin, "latest closed trades", streaks.currentWin ? "pos" : "neutral")}
      ${metric("Current Loss Streak", streaks.currentLoss, "latest closed trades", streaks.currentLoss ? "neg" : "neutral")}
      ${metric("Best Win Streak", streaks.bestWin, "all time", "pos")}
      ${metric("Worst Loss Streak", streaks.worstLoss, "all time", streaks.worstLoss ? "neg" : "neutral")}
      ${metric("Patience Edge", streaks.bestWin || streaks.worstLoss ? "Tracked" : "-", "streak tracker")}
    </div>
    <div class="analysis-grid">
      <div class="panel panel-pad">
        <div class="panel-title"><span>Equity Curve</span><span class="section-pill ${moneyClass(p.totalPnl)}">${signed(p.totalPnl)} $</span></div>
        ${equitySvg()}
      </div>
      <div class="panel panel-pad">
        <div class="panel-title"><span>Auto Insights</span><span class="section-pill neutral">${p.closed.length} closed</span></div>
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
    ${comboAnalysisTable()}
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
  const bestDay = bestWeekdayInsight();
  const patience = patienceCostInsight();
  const counterTrend = counterTrendInsight();
  return [
    insight("trophy", "Best level", bestLevel ? `${bestLevel.key}: ${signed(bestLevel.pnl)} $ across ${bestLevel.count} trades.` : "No clear level edge yet."),
    insight("clock-3", "Best session", bestSession ? `${bestSession.key}: ${bestSession.winRate.toFixed(0)}% win rate.` : "No clear session edge yet."),
    insight("alert-triangle", "Costly mistake", costlyMistake ? `${costlyMistake.key}: ${signed(costlyMistake.pnl)} $. Reduce this first.` : "No mistake pattern detected."),
    insight(streak.type === "WIN" ? "flame" : "activity", "Current streak", streak.count ? `${streak.count} ${streak.type.toLowerCase()} trade(s) in a row.` : "No closed streak yet."),
    insight("calendar-check", "Best day of week", bestDay || "No weekday edge yet."),
    insight("gauge", "Patience insight", patience || "More scored trades are needed for patience insight."),
    insight("route-off", "Counter trend alert", counterTrend || "Counter trend risk looks stable so far.")
  ].join("");
}

function bestWeekdayInsight() {
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const map = new Map(weekdays.map((day) => [day, { day, trades: 0, wins: 0 }]));
  performance().closed.forEach((trade) => {
    if (!trade.date) return;
    const day = new Date(`${trade.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
    if (!map.has(day)) return;
    const row = map.get(day);
    row.trades += 1;
    row.wins += trade.result === "WIN" ? 1 : 0;
  });
  const rows = Array.from(map.values()).filter((row) => row.trades > 0);
  if (!rows.length) return "";
  const best = rows.sort((a, b) => (b.wins / b.trades) - (a.wins / a.trades) || b.trades - a.trades)[0];
  return `${best.day}: ${((best.wins / best.trades) * 100).toFixed(0)}% win rate`;
}

function avgPatienceNumber(result) {
  const rows = performance().closed.filter((trade) => trade.result === result && trade.patienceScore);
  if (!rows.length) return null;
  return rows.reduce((sum, trade) => sum + (parseInt(trade.patienceScore, 10) || 0), 0) / rows.length;
}

function patienceCostInsight() {
  const lossAvg = avgPatienceNumber("LOSS");
  const winAvg = avgPatienceNumber("WIN");
  if (lossAvg === null || winAvg === null || lossAvg >= winAvg) return "";
  const lowPatienceLoss = performance().closed
    .filter((trade) => trade.result === "LOSS" && trade.patienceScore && parseInt(trade.patienceScore, 10) < winAvg)
    .reduce((sum, trade) => sum + Math.abs(parseFloat(trade.pnl) || parseFloat(calcPnl(trade.risk, trade.reward, trade.result)) || 0), 0);
  return `Impatient entries cost you ${round1(lowPatienceLoss)} $. Score ≥4 trades win ${patienceWinRate((score) => score >= 4)} vs ${patienceWinRate((score) => score <= 2)} for ≤2.`;
}

function biasWinRate(label) {
  const rows = performance().closed.filter((trade) => trade.biasAlignment === label);
  if (!rows.length) return null;
  const wins = rows.filter((trade) => trade.result === "WIN").length;
  return { count: rows.length, winRate: (wins / rows.length) * 100 };
}

function counterTrendInsight() {
  const withTrend = biasWinRate("With Trend");
  const counterTrend = biasWinRate("Counter Trend");
  if (!withTrend || !counterTrend || counterTrend.winRate >= withTrend.winRate) return "";
  return `Counter Trend trades win ${counterTrend.winRate.toFixed(0)}% vs ${withTrend.winRate.toFixed(0)}% with trend.`;
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

function bestWinRateKey(catKey, field) {
  if (!["levels", "tfs", "sessions"].includes(catKey)) return "";
  const groups = grouped(catKey, field).filter((item) => item.count >= 3);
  if (!groups.length) return "";
  return groups.sort((a, b) => b.winRate - a.winRate || b.count - a.count || b.pnl - a.pnl)[0].key;
}

function analysisTable(title, catKey, field) {
  const bestKey = bestWinRateKey(catKey, field);
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
        <td class="key-cell" data-label="Name">${escapeHtml(key)}${bestKey === key ? ` <span class="best-badge">⭐ Best</span>` : ""}</td>
        <td data-label="Trades"><span class="count-chip chip-total">${g.count}</span></td>
        <td class="pos" data-label="Wins"><span class="count-chip chip-win">${g.wins}</span></td>
        <td class="neg" data-label="Losses"><span class="count-chip chip-loss">${losses}</span></td>
        <td class="neutral" data-label="BE"><span class="count-chip chip-be">${bes}</span></td>
        <td data-label="Win Rate">
          <div class="wr-cell">
            <div class="wr-bar"><div class="wr-fill" style="width:${g.winRate.toFixed(0)}%;background:${color}"></div></div>
            <span>${g.count ? `${g.winRate.toFixed(0)}%` : "-"}</span>
          </div>
        </td>
        <td class="${moneyClass(g.pnl)}" data-label="Total P&L">${g.count ? signed(g.pnl) : "-"}</td>
        <td data-label="Avg Win RR">${avgRR ? `1:${avgRR.toFixed(2)}` : "-"}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="a-section">
      <div class="panel-title"><span>${escapeHtml(title)}</span><span class="section-pill">auto ranked</span></div>
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

function comboAnalysisRows(closedTrades = performance().closed) {
  const map = new Map();
  closedTrades.forEach((trade) => {
    const level = trade.level || "-";
    const tf = trade.tf || "-";
    const session = trade.session || "-";
    const confirmationType = trade.confirmationType || "-";
    const key = [level, tf, session, confirmationType].join("||");
    if (!map.has(key)) {
      map.set(key, {
        level,
        tf,
        session,
        confirmationType,
        trades: 0,
        wins: 0,
        losses: 0,
        be: 0,
        pnl: 0
      });
    }
    const row = map.get(key);
    row.trades += 1;
    row.wins += trade.result === "WIN" ? 1 : 0;
    row.losses += trade.result === "LOSS" ? 1 : 0;
    row.be += trade.result === "BE" ? 1 : 0;
    row.pnl = round1(row.pnl + (parseFloat(trade.pnl) || 0));
  });

  return Array.from(map.values())
    .map((row) => ({ ...row, winRate: row.trades ? (row.wins / row.trades) * 100 : 0 }))
    .sort((a, b) => b.trades - a.trades || b.winRate - a.winRate || b.pnl - a.pnl || a.level.localeCompare(b.level));
}

function comboAnalysisTable() {
  const minTrades = Math.max(1, parseInt(uiState.comboMinTrades, 10) || 2);
  const rows = comboAnalysisRows().filter((row) => row.trades >= minTrades);
  const body = rows.length ? rows.map((row) => {
    const color = row.winRate >= 60 ? "var(--green)" : row.winRate >= 40 ? "var(--amber)" : "var(--red)";
    return `
      <tr>
        <td class="key-cell" data-label="Level">${escapeHtml(row.level)}</td>
        <td data-label="TF">${escapeHtml(row.tf)}</td>
        <td class="key-cell" data-label="Session">${escapeHtml(row.session)}</td>
        <td class="key-cell" data-label="Confirmation">${escapeHtml(row.confirmationType)}</td>
        <td data-label="Trades"><span class="count-chip chip-total">${row.trades}</span></td>
        <td class="pos" data-label="Wins"><span class="count-chip chip-win">${row.wins}</span></td>
        <td class="neg" data-label="Losses"><span class="count-chip chip-loss">${row.losses}</span></td>
        <td class="neutral" data-label="BE"><span class="count-chip chip-be">${row.be}</span></td>
        <td data-label="Win Rate">
          <div class="wr-cell">
            <div class="wr-bar"><div class="wr-fill" style="width:${row.winRate.toFixed(0)}%;background:${color}"></div></div>
            <span>${row.winRate.toFixed(0)}%</span>
          </div>
        </td>
        <td class="${moneyClass(row.pnl)}" data-label="Total P&L">${signed(row.pnl)}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="10" class="cell-nil">No closed trades yet.</td></tr>`;

  return `
    <div class="a-section">
      <div class="panel-title"><span>Level x Timeframe x Session x Confirmation Type Win Rate</span><span class="section-pill">edge scanner</span></div>
      <div class="combo-filter">
        <label class="field compact-field">
          <span>Min trades</span>
          <input id="combo-min-trades" type="number" min="1" step="1" value="${minTrades}" onchange="updateComboMinTrades(this.value)">
        </label>
      </div>
      <div class="cross-wrap">
        <table class="a-table combo-table">
          <thead>
            <tr><th>Level</th><th>TF</th><th>Session</th><th>Confirmation</th><th>Trades</th><th>Wins</th><th>Losses</th><th>BE</th><th>Win Rate</th><th>Total P&L</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `;
}

function updateComboMinTrades(value) {
  uiState.comboMinTrades = Math.max(1, parseInt(value, 10) || 1);
  renderAnalysis();
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
            <p>Daily P&L in $</p>
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
              <strong>${signed(row.weekPnl)} $</strong>
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
          <b>${signed(stats.totalPnl)} $</b>
        </div>
        <div class="pnl-info-card">
          <span>Avg Daily P/L</span>
          <b>${signed(stats.avgDaily)} $</b>
        </div>
        <div class="pnl-info-card">
          <span><i data-lucide="trending-up"></i> Best Day</span>
          <b class="pos">${stats.best ? `${signed(stats.best.pnl)} $` : "-"}</b>
          <small>${stats.best ? formatDateDisplay(stats.best.date) : "No data"}</small>
        </div>
        <div class="pnl-info-card">
          <span><i data-lucide="trending-down"></i> Worst Day</span>
          <b class="neg">${stats.worst ? `${signed(stats.worst.pnl)} $` : "-"}</b>
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
          <p>${selected ? `${selected.trades} trade${selected.trades === 1 ? "" : "s"}  ${signed(selected.pnl)} $` : "No trades"}</p>
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
      <b>${day ? `${signed(day.pnl)} $` : "No data"}</b>
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

function skippedTradesForRange(range = reportRange()) {
  return state.skippedTrades
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

function reportComboAnalysisTable(items) {
  const rows = comboAnalysisRows(items.filter(({ trade }) => trade.result).map(({ trade }) => trade));
  if (!rows.length) return "";
  return `
    <section class="r-section">
      <h2>Level x Timeframe x Session x Confirmation Type Win Rate</h2>
      <table class="r-table compact">
        <thead><tr><th>Level</th><th>TF</th><th>Session</th><th>Confirmation</th><th>Trades</th><th>Wins</th><th>Loss</th><th>BE</th><th>Win Rate</th><th>P&L</th></tr></thead>
        <tbody>
          ${rows.map((row) => `<tr><td>${escapeHtml(row.level)}</td><td>${escapeHtml(row.tf)}</td><td>${escapeHtml(row.session)}</td><td>${escapeHtml(row.confirmationType)}</td><td>${row.trades}</td><td class="r-pos">${row.wins}</td><td class="r-neg">${row.losses}</td><td>${row.be}</td><td>${row.winRate.toFixed(0)}%</td><td class="${row.pnl >= 0 ? "r-pos" : "r-neg"}">${signed(row.pnl)}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function reportSkippedTradesSection(range = reportRange()) {
  const items = skippedTradesForRange(range);
  const stats = skippedStats(items.map(({ trade }) => trade));
  const rows = items.map(({ trade }) => `
    <tr>
      <td>${escapeHtml(formatDateDisplay(trade.date) || "-")}</td>
      <td>${escapeHtml(trade.session || "-")}</td>
      <td>${escapeHtml(trade.level || "-")}</td>
      <td>${escapeHtml(trade.tf || "-")}</td>
      <td>${reportBadge(trade.direction, "entry")}</td>
      <td>${escapeHtml(trade.skipReason || "-")}</td>
      <td>${escapeHtml(trade.confidence ? `${trade.confidence}/5` : "-")}</td>
      <td>${escapeHtml(trade.outcome || "-")}</td>
      <td>${escapeHtml(optionalDisplay(trade.pipsMissed))}</td>
      <td class="r-note-cell">${escapeHtml(trade.notes || "-")}</td>
    </tr>
  `).join("");

  return `
    <section class="r-section">
      <h2>Skipped Trades</h2>
      <section class="r-summary skipped-r-summary">
        <div><span>Total Skipped</span><b>${stats.total}</b></div>
        <div><span>Would Win</span><b class="r-pos">${stats.wins.length}</b></div>
        <div><span>Would Lose</span><b class="r-neg">${stats.losses.length}</b></div>
        <div><span>Skipped Win Rate</span><b>${stats.winRate.toFixed(1)}%</b></div>
        <div><span>Avg $ Missed</span><b>${stats.avgPipsMissed.toFixed(1)} $</b></div>
      </section>
      <table class="r-table">
        <thead><tr><th>Date</th><th>Session</th><th>Level</th><th>TF</th><th>Direction</th><th>Skip Reason</th><th>Confidence</th><th>Outcome</th><th>$ Missed</th><th>Notes</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10">No skipped trades found for this range.</td></tr>`}</tbody>
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
      <td>${escapeHtml(trade.marketCondition || "-")}</td>
      <td>${escapeHtml(trade.biasAlignment || "-")}</td>
      <td>${escapeHtml(trade.confirmationType || "-")}</td>
      <td>${escapeHtml(trade.slTpPlacement || "-")}</td>
      <td>${escapeHtml(trade.patienceScore ? `P${trade.patienceScore}` : "-")}</td>
      <td>${escapeHtml(trade.risk || "-")}</td>
      <td>${escapeHtml(trade.reward || "-")}</td>
      <td>${escapeHtml(calcRR(trade.risk, trade.reward) || "-")}</td>
      <td>${reportBadge(trade.result, "result")}</td>
      <td class="${moneyClass(pnl) === "pos" ? "r-pos" : moneyClass(pnl) === "neg" ? "r-neg" : ""}">${pnl === "" ? "-" : signed(pnl)}</td>
      <td>${cum === "" ? "-" : signed(cum)}</td>
      <td class="r-note-cell">${escapeHtml(trade.reason || "-")}</td>
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
        <div><span>Total P&L</span><b class="${p.totalPnl >= 0 ? "r-pos" : "r-neg"}">${signed(p.totalPnl)} $</b></div>
        <div><span>Profit Factor</span><b>${p.profitFactor.toFixed(2)}</b></div>
        <div><span>Expectancy</span><b class="${p.expectancy >= 0 ? "r-pos" : "r-neg"}">${signed(p.expectancy)} $</b></div>
      </section>
      <section class="r-section">
        <h2>Trade Log</h2>
        <table class="r-table full-log">
          <thead><tr><th>#</th><th>Date</th><th>Session</th><th>Side</th><th>Level</th><th>TF</th><th>Setup</th><th>Mistake</th><th>Hold</th><th>Market</th><th>Bias</th><th>Confirm</th><th>SL/TP</th><th>Patience</th><th>Risk</th><th>Reward</th><th>RR</th><th>Result</th><th>P&L</th><th>Cum</th><th>Notes / Reason</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="21">No trades found for this range.</td></tr>`}</tbody>
        </table>
      </section>
      ${reportSkippedTradesSection(range)}
      <div class="r-analysis-grid">
        ${reportAnalysisTable("Session Analysis", items, "session")}
        ${reportAnalysisTable("Level Analysis", items, "level")}
        ${reportAnalysisTable("Setup Analysis", items, "setup")}
        ${reportAnalysisTable("Mistake Analysis", items, "mistake")}
        ${reportAnalysisTable("Hold Quality Analysis", items, "hold")}
        ${reportAnalysisTable("Market Condition Analysis", items, "marketCondition")}
        ${reportAnalysisTable("Bias Alignment Analysis", items, "biasAlignment")}
        ${reportAnalysisTable("Confirmation Type Analysis", items, "confirmationType")}
        ${reportAnalysisTable("SL/TP Placement Analysis", items, "slTpPlacement")}
      </div>
      ${reportComboAnalysisTable(items)}
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

async function clearAllTrades() {
  if (!state.trades.length) {
    toast("No trades to clear.");
    return;
  }
  if (!confirm("Clear all trades for the selected account from this device and Firebase? This cannot be undone.")) return;
  state.trades = [];
  try {
    persistLocalState();
  } catch (error) {
    console.warn("Could not clear local trade cache", error);
  }
  renderTrades();
  if (document.getElementById("tab-analysis")?.classList.contains("active")) renderAnalysis();
  if (document.getElementById("tab-pnl")?.classList.contains("active")) renderPnl();

  if (currentUser && window.firebaseDb) {
    try {
      updateSyncStatus("syncing");
      await clearAccountFirestoreCollection(currentUser.uid, activeAccountId, "trades");
      updateSyncStatus("synced");
      toast("Selected account trades cleared from device and Firebase.");
      return;
    } catch (error) {
      console.warn("Could not clear Firebase trades", error);
      updateSyncStatus("offline");
      toast("Local trades cleared. Firebase clear failed.");
      return;
    }
  }

  toast("Selected account local trades cleared.");
}

function openMobileMenu() {
  document.body.classList.add("mobile-menu-open");
}

function closeMobileMenu() {
  document.body.classList.remove("mobile-menu-open");
}

function showLoginScreen() {
  document.getElementById("login-screen")?.removeAttribute("hidden");
  document.querySelector(".app")?.setAttribute("hidden", "");
  document.querySelector(".mobile-topbar")?.setAttribute("hidden", "");
  document.querySelector(".bottom-nav")?.setAttribute("hidden", "");
}

function hideLoginScreen() {
  document.getElementById("login-screen")?.setAttribute("hidden", "");
  document.querySelector(".app")?.removeAttribute("hidden");
  document.querySelector(".mobile-topbar")?.removeAttribute("hidden");
  document.querySelector(".bottom-nav")?.removeAttribute("hidden");
}

async function signInWithGoogle() {
  if (!window.firebaseAuth || !window.GoogleAuthProvider || !window.signInWithPopup) {
    toast("Firebase is still loading.");
    return;
  }
  const provider = new window.GoogleAuthProvider();
  await window.signInWithPopup(window.firebaseAuth, provider);
}

async function signOutUser() {
  if (!window.firebaseAuth || !window.firebaseSignOut) return;
  await window.firebaseSignOut(window.firebaseAuth);
}

function updateUserRow(user) {
  const row = document.getElementById("user-row");
  const avatar = document.getElementById("user-avatar");
  const name = document.getElementById("user-name");
  if (!row || !avatar || !name) return;
  if (!user) {
    row.hidden = true;
    avatar.src = "";
    name.textContent = "";
    return;
  }
  row.hidden = false;
  avatar.src = user.photoURL || "";
  name.textContent = user.displayName || user.email || "Signed in";
}

function updateSyncStatus(status) {
  const wrap = document.getElementById("sync-status");
  if (!wrap) return;
  const dot = wrap.querySelector(".sync-dot");
  const label = wrap.querySelector(".sync-label");
  if (!dot || !label) return;
  dot.className = `sync-dot ${status}`;
  label.textContent = status === "synced" ? "Synced" : status === "syncing" ? "Syncing..." : "Offline - local only";
}

function userDocRef(uid, collectionName, documentId) {
  return window.firestoreDoc(window.firebaseDb, "users", uid, collectionName, documentId);
}

function userCollectionRef(uid, collectionName) {
  return window.firestoreCollection(window.firebaseDb, "users", uid, collectionName);
}

function accountDocRef(uid, accountId) {
  return window.firestoreDoc(window.firebaseDb, "users", uid, "accounts", accountId);
}

function accountDataDocRef(uid, accountId, collectionName, documentId) {
  return window.firestoreDoc(window.firebaseDb, "users", uid, "accounts", accountId, collectionName, documentId);
}

function accountDataCollectionRef(uid, accountId, collectionName) {
  return window.firestoreCollection(window.firebaseDb, "users", uid, "accounts", accountId, collectionName);
}

async function loadFromFirestore(uid) {
  if (!window.firebaseDb) return;
  updateSyncStatus("syncing");
  try {
    const accountsSnap = await window.firestoreGetDocs(userCollectionRef(uid, "accounts"));
    const cloudAccounts = accountsSnap.docs.map((docSnap) => normalizeAccount({ id: docSnap.id, ...docSnap.data() }));

    if (cloudAccounts.length) {
      accounts = cloudAccounts.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      if (!accounts.some((account) => account.id === DEFAULT_ACCOUNT_ID)) accounts.unshift(defaultAccount());
      if (!accounts.some((account) => account.id === activeAccountId)) activeAccountId = accounts[0].id;
      await loadAccountFromFirestore(uid, activeAccountId);
      const legacyState = await readLegacyFirestoreState(uid);
      if (journalRowCount(legacyState)) {
        accountData[DEFAULT_ACCOUNT_ID] = mergeJournalStates(accountData[DEFAULT_ACCOUNT_ID] || emptyJournalState(uid), legacyState);
        if (activeAccountId === DEFAULT_ACCOUNT_ID) state = normalizeJournalState(accountData[DEFAULT_ACCOUNT_ID]);
        await saveToFirestore();
      }
      persistLocalState();
      renderCurrentAccount();
    } else {
      await loadLegacyFirestoreState(uid);
      await saveToFirestore();
    }

    updateSyncStatus("synced");
  } catch (error) {
    console.warn("Could not load from Firestore", error);
    updateSyncStatus("offline");
  }
}

async function loadLegacyFirestoreState(uid) {
  const legacyState = await readLegacyFirestoreState(uid);
  if (journalRowCount(legacyState)) {
    state = mergeJournalStates(state, legacyState);
  }

  if (!accounts.length) accounts = [defaultAccount()];
  if (!activeAccountId) activeAccountId = accounts[0].id;
  accountData[activeAccountId] = normalizeJournalState(state);
  persistLocalState();
  renderCurrentAccount();
}

async function readLegacyFirestoreState(uid) {
  const [optionsSnap, settingsSnap, tradesSnap, skippedTradesSnap, reviewsSnap] = await Promise.all([
    window.firestoreGetDoc(userDocRef(uid, "options", "data")),
    window.firestoreGetDoc(userDocRef(uid, "settings", "data")),
    window.firestoreGetDocs(userCollectionRef(uid, "trades")),
    window.firestoreGetDocs(userCollectionRef(uid, "skippedTrades")),
    window.firestoreGetDocs(userCollectionRef(uid, "weeklyReviews"))
  ]);

  const cloudTrades = tradesSnap.docs.map((docSnap) => normalizeTrade({ id: docSnap.id, ...docSnap.data() }));
  const cloudSkippedTrades = skippedTradesSnap.docs.map((docSnap) => normalizeSkippedTrade({ id: docSnap.id, ...docSnap.data() }));
  const cloudReviews = reviewsSnap.docs.map((docSnap) => normalizeWeeklyReview({ id: docSnap.id, ...docSnap.data() }));
  return normalizeJournalState({
    ownerUid: uid,
    trades: cloudTrades.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    skippedTrades: cloudSkippedTrades.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    weeklyReviews: cloudReviews,
    options: optionsSnap.exists() ? optionsSnap.data() : FIXED,
    settings: settingsSnap.exists() ? settingsSnap.data() : {}
  });
}

async function loadAccountFromFirestore(uid, accountId) {
  const [accountSnap, optionsSnap, settingsSnap, tradesSnap, skippedTradesSnap, reviewsSnap] = await Promise.all([
    window.firestoreGetDoc(accountDocRef(uid, accountId)),
    window.firestoreGetDoc(accountDataDocRef(uid, accountId, "options", "data")),
    window.firestoreGetDoc(accountDataDocRef(uid, accountId, "settings", "data")),
    window.firestoreGetDocs(accountDataCollectionRef(uid, accountId, "trades")),
    window.firestoreGetDocs(accountDataCollectionRef(uid, accountId, "skippedTrades")),
    window.firestoreGetDocs(accountDataCollectionRef(uid, accountId, "weeklyReviews"))
  ]);

  if (accountSnap.exists()) {
    const account = normalizeAccount({ id: accountId, ...accountSnap.data() });
    const index = accounts.findIndex((item) => item.id === accountId);
    if (index >= 0) accounts[index] = account;
  }

  const cloudState = normalizeJournalState({
    ownerUid: uid,
    trades: tradesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
    skippedTrades: skippedTradesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
    weeklyReviews: reviewsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
    options: optionsSnap.exists() ? optionsSnap.data() : FIXED,
    settings: settingsSnap.exists() ? settingsSnap.data() : {}
  });
  const localState = normalizeJournalState(accountData[accountId] || {});
  const cloudRows = cloudState.trades.length + cloudState.skippedTrades.length + cloudState.weeklyReviews.length;
  const localRows = localState.trades.length + localState.skippedTrades.length + localState.weeklyReviews.length;

  state = cloudRows >= localRows ? cloudState : localState;
  activeAccountId = accountId;
  accountData[accountId] = clone(state);
}

async function syncCollection(uid, collectionName, rows) {
  const colRef = userCollectionRef(uid, collectionName);
  const existing = await window.firestoreGetDocs(colRef);
  const keep = new Set(rows.map((row) => row.id));
  await Promise.all(rows.map((row) => window.firestoreSetDoc(userDocRef(uid, collectionName, row.id), row, { merge: true })));
  await Promise.all(existing.docs.filter((docSnap) => !keep.has(docSnap.id)).map((docSnap) => window.firestoreDeleteDoc(userDocRef(uid, collectionName, docSnap.id))));
}

async function syncAccountCollection(uid, accountId, collectionName, rows) {
  const colRef = accountDataCollectionRef(uid, accountId, collectionName);
  const existing = await window.firestoreGetDocs(colRef);
  const keep = new Set(rows.map((row) => row.id));
  await Promise.all(rows.map((row) => window.firestoreSetDoc(accountDataDocRef(uid, accountId, collectionName, row.id), row, { merge: true })));
  await Promise.all(existing.docs.filter((docSnap) => !keep.has(docSnap.id)).map((docSnap) => window.firestoreDeleteDoc(accountDataDocRef(uid, accountId, collectionName, docSnap.id))));
}

async function clearFirestoreCollection(uid, collectionName) {
  const existing = await window.firestoreGetDocs(userCollectionRef(uid, collectionName));
  await Promise.all(existing.docs.map((docSnap) => window.firestoreDeleteDoc(userDocRef(uid, collectionName, docSnap.id))));
}

async function clearAccountFirestoreCollection(uid, accountId, collectionName) {
  const existing = await window.firestoreGetDocs(accountDataCollectionRef(uid, accountId, collectionName));
  await Promise.all(existing.docs.map((docSnap) => window.firestoreDeleteDoc(accountDataDocRef(uid, accountId, collectionName, docSnap.id))));
}

async function saveToFirestore() {
  if (!currentUser || !window.firebaseDb) return;
  updateSyncStatus("syncing");
  const uid = currentUser.uid;
  state.ownerUid = uid;
  if (!accounts.length) accounts = [defaultAccount()];
  const account = activeAccount();
  account.updatedAt = new Date().toISOString();
  const trades = state.trades.map((trade) => normalizeTrade(trade));
  const skippedTrades = state.skippedTrades.map((trade) => normalizeSkippedTrade(trade));
  const weeklyReviews = state.weeklyReviews.map((review) => normalizeWeeklyReview(review));
  state.trades = trades;
  state.skippedTrades = skippedTrades;
  state.weeklyReviews = weeklyReviews;
  try {
    persistLocalState();
  } catch (error) {
    console.warn("Could not refresh local cache", error);
  }

  await Promise.all(accounts.map(async (item) => {
    const data = normalizeJournalState(accountData[item.id] || emptyJournalState(uid));
    await window.firestoreSetDoc(accountDocRef(uid, item.id), normalizeAccount(item), { merge: true });
    await Promise.all([
      syncAccountCollection(uid, item.id, "trades", data.trades),
      syncAccountCollection(uid, item.id, "skippedTrades", data.skippedTrades),
      syncAccountCollection(uid, item.id, "weeklyReviews", data.weeklyReviews),
      window.firestoreSetDoc(accountDataDocRef(uid, item.id, "options", "data"), clone(data.options), { merge: true }),
      window.firestoreSetDoc(accountDataDocRef(uid, item.id, "settings", "data"), clone(data.settings), { merge: true })
    ]);
  }));
  updateSyncStatus("synced");
}

function initRealtimeSync() {
  if (!window.firebaseRtdb || !window.rtdbRef || !window.rtdbOnValue) return;
  window.rtdbOnValue(window.rtdbRef(window.firebaseRtdb, ".info/connected"), (snapshot) => {
    updateSyncStatus(snapshot.val() ? "synced" : "offline");
  }, () => updateSyncStatus("offline"));
}

function initFirebaseAuth() {
  if (firebaseReady || !window.initializeFirebaseServices) return;
  firebaseReady = true;
  if (!hasFirebaseConfig()) {
    console.warn("Firebase config missing. Copy firebase-config.example.js to firebase-config.js and fill your project values.");
    updateSyncStatus("offline");
    showLoginScreen();
    return;
  }
  try {
    window.initializeFirebaseServices(FIREBASE_CONFIG);
  } catch (error) {
    console.warn("Firebase initialization failed", error);
    updateSyncStatus("offline");
    showLoginScreen();
    return;
  }
  if (!window.firebaseAuth || !window.onAuthStateChanged) return;
  window.onAuthStateChanged(window.firebaseAuth, async (user) => {
    currentUser = user || null;
    updateUserRow(user);
    if (!user) {
      firestoreLoadComplete = false;
      showLoginScreen();
      updateSyncStatus("offline");
      return;
    }
    hideLoginScreen();
    loadState();
    state.ownerUid = user.uid;
    renderCurrentAccount();
    initRealtimeSync();
    await loadFromFirestore(user.uid);
    firestoreLoadComplete = true;
  });
}

function switchTab(name, button) {
  document.querySelectorAll(".nav-btn, .bottom-nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById(`tab-${name}`)?.classList.add("active");
  if (name === "missed") renderSkippedTrades();
  if (name === "analysis") renderAnalysisWithDelay();
  if (name === "pnl") renderPnl();
  if (name === "weekly") renderWeeklyReviews();
  if (name === "manage") renderManage();
  closeMobileMenu();
  refreshIcons();
}

function exportRows() {
  recalcCum();
  const headers = ["#", "Date", "Session", "Side", "Level", "TF", "Setup", "Mistake", "Hold", "Market Condition", "Bias Alignment", "Confirmation Type", "SL/TP Placement", "Patience Score", "Risk($)", "Reward($)", "RR", "Result", "P&L($)", "Cumul P&L", "Notes"];
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
    trade.marketCondition,
    trade.biasAlignment,
    trade.confirmationType,
    trade.slTpPlacement,
    trade.patienceScore,
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

function skippedExportRows(trades = state.skippedTrades) {
  const headers = ["Date", "Session", "Level", "TF", "Direction", "Skip Reason", "Confidence", "Outcome", "$ Missed", "Notes"];
  const rows = trades
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((trade) => [
      formatDateDisplay(trade.date),
      trade.session,
      trade.level,
      trade.tf,
      trade.direction,
      trade.skipReason,
      trade.confidence,
      trade.outcome,
      trade.pipsMissed,
      trade.notes || ""
    ]);
  return { headers, rows };
}

function exportCSV() {
  const { headers, rows } = exportRows();
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  download(`data:text/csv;charset=utf-8,\uFEFF${encodeURIComponent(csv)}`, "Gold_Journal.csv");
}

function exportSkippedCSV() {
  const { headers, rows } = skippedExportRows(filteredSkippedTrades().map(({ trade }) => trade));
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  download(`data:text/csv;charset=utf-8,\uFEFF${encodeURIComponent(csv)}`, "Skipped_Trades.csv");
  toast("Skipped trades CSV downloaded.");
}

function exportSkippedExcel() {
  if (typeof XLSX === "undefined") {
    alert("XLSX library is not loaded. Please reload the page.");
    return;
  }
  const skipped = skippedExportRows(filteredSkippedTrades().map(({ trade }) => trade));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([skipped.headers, ...skipped.rows]);
  ws["!cols"] = [14, 24, 14, 8, 10, 30, 12, 18, 12, 42].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "Skipped Trades");
  XLSX.writeFile(wb, "Skipped_Trades.xlsx");
}

function exportExcel() {
  if (typeof XLSX === "undefined") {
    alert("XLSX library is not loaded. Please reload the page.");
    return;
  }
  const { headers, rows } = exportRows();
  const wb = XLSX.utils.book_new();
  const wsTrades = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsTrades["!cols"] = [4, 12, 24, 8, 14, 8, 12, 18, 18, 18, 22, 20, 18, 14, 10, 12, 9, 9, 10, 12, 34].map((wch) => ({ wch }));
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

  const comboRows = comboAnalysisRows();
  const comboSheet = [
    ["Level", "TF", "Session", "Confirmation Type", "Trades", "Wins", "Losses", "BE", "Win Rate %", "Total P&L"],
    ...comboRows.map((row) => [
      row.level,
      row.tf,
      row.session,
      row.confirmationType,
      row.trades,
      row.wins,
      row.losses,
      row.be,
      +row.winRate.toFixed(1),
      +row.pnl.toFixed(1)
    ])
  ];
  const wsCombo = XLSX.utils.aoa_to_sheet(comboSheet);
  wsCombo["!cols"] = [14, 8, 24, 20, 10, 8, 8, 8, 12, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsCombo, "Combo Analysis");

  const skipped = skippedExportRows();
  const wsSkipped = XLSX.utils.aoa_to_sheet([skipped.headers, ...skipped.rows]);
  wsSkipped["!cols"] = [14, 24, 14, 8, 10, 30, 12, 18, 12, 42].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsSkipped, "Skipped Trades");

  const weeklySheet = [
    ["Week Of", "Learned", "Pattern", "Improve"],
    ...state.weeklyReviews
      .slice()
      .sort((a, b) => String(b.weekOf).localeCompare(String(a.weekOf)))
      .map((review) => [formatDateDisplay(review.weekOf) || review.weekOf, review.learned, review.pattern, review.improve])
  ];
  const wsWeekly = XLSX.utils.aoa_to_sheet(weeklySheet);
  wsWeekly["!cols"] = [{ wch: 14 }, { wch: 42 }, { wch: 42 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, wsWeekly, "weeklyReviews");

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
  renderCurrentAccount();
  showLoginScreen();
  updateSyncStatus("syncing");
  refreshIcons();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("trade-modal")?.hidden) closeTradeModal();
    if (event.key === "Escape" && !document.getElementById("skipped-modal")?.hidden) closeSkippedModal();
  });
  document.getElementById("trade-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "trade-modal") closeTradeModal();
  });
  document.getElementById("skipped-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "skipped-modal") closeSkippedModal();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker registration failed", error));
  }
  window.addEventListener("firebase-sdk-ready", initFirebaseAuth);
  if (window.initializeFirebaseServices) initFirebaseAuth();
}

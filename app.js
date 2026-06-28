// --- Supabase Client ---
let supabaseClient = null;
let supabaseConfig = null;
let supabaseReady = false;
let authLoadToken = 0;
let authProviders = { email: true, google: true };
let authMode = "signin";
let authBusy = false;
let authPasswordVisible = false;
let authInitStarted = false;
let authStateBusy = false;
let diagnosticsState = {
  auth: {},
  storage: {},
  cache: {},
  ai: {},
  performance: {},
  events: []
};

function safeStorageGet(storage, key, fallback = "") {
  try {
    const value = storage?.getItem?.(key);
    return value ?? fallback;
  } catch (error) {
    console.warn("Storage read failed", error);
    return fallback;
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch (error) {
    console.warn("Storage write failed", error);
    return false;
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
    return true;
  } catch (error) {
    console.warn("Storage remove failed", error);
    return false;
  }
}

function safeStorageClearMatching(storage, predicate) {
  try {
    const keys = Object.keys(storage || {});
    keys.filter((key) => predicate(key)).forEach((key) => storage.removeItem(key));
    return true;
  } catch (error) {
    console.warn("Storage clear failed", error);
    return false;
  }
}

function recordDiagnostic(kind, message, detail = {}) {
  const entry = {
    ts: new Date().toISOString(),
    kind,
    message,
    detail
  };
  diagnosticsState.events.push(entry);
  if (diagnosticsState.events.length > 80) diagnosticsState.events = diagnosticsState.events.slice(-80);
  if (typeof console !== "undefined") {
    const logger = kind === "error" ? console.error : console.info;
    logger(`[${kind}] ${message}`, detail);
  }
  updateDiagnosticsPanel();
}

function updateDiagnosticsPanel() {
  const panel = document.getElementById("diagnostics-panel");
  const content = document.getElementById("diagnostics-content");
  if (!panel || !content) return;
  const memoryUsage = typeof performance !== "undefined" && performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB / ${Math.round(performance.memory.jsHeapSizeLimit / 1048576)}MB` : "n/a";
  const authState = currentUser ? `signed in (${currentUser.email || currentUser.id || "user"})` : "signed out";
  const dbState = supabaseReady ? "Supabase ready" : "offline";
  const storageState = typeof indexedDB !== "undefined" ? "IndexedDB available" : "unavailable";
  const cacheState = "serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "active" : "ready") : "disabled";
  const aiState = diagnosticsState.ai?.status || "idle";
  const backgroundTasks = `${diagnosticsState.events.length} events`;
  content.innerHTML = `
    <div class="diag-grid">
      <div class="diag-card"><strong>Auth</strong><span>${escapeHtml(authState)}</span></div>
      <div class="diag-card"><strong>Database</strong><span>${escapeHtml(dbState)}</span></div>
      <div class="diag-card"><strong>Storage</strong><span>${escapeHtml(storageState)}</span></div>
      <div class="diag-card"><strong>Cache</strong><span>${escapeHtml(cacheState)}</span></div>
      <div class="diag-card"><strong>AI</strong><span>${escapeHtml(aiState)}</span></div>
      <div class="diag-card"><strong>Memory</strong><span>${escapeHtml(memoryUsage)}</span></div>
      <div class="diag-card"><strong>Background</strong><span>${escapeHtml(backgroundTasks)}</span></div>
      <div class="diag-card"><strong>Last Event</strong><span>${escapeHtml(diagnosticsState.events.at(-1)?.message || "none")}</span></div>
    </div>
  `;
}

function toggleDiagnosticsPanel() {
  const panel = document.getElementById("diagnostics-panel");
  if (!panel) return;
  panel.hidden = !panel.hidden;
  updateDiagnosticsPanel();
}

function installGlobalErrorHandlers() {
  window.addEventListener("error", (event) => {
    const message = event.error?.message || event.message || "Unhandled runtime error";
    recordDiagnostic("error", message, { filename: event.filename, lineno: event.lineno, colno: event.colno });
    if (typeof toast === "function") toast("A runtime error occurred. Check diagnostics for details.");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason?.message || String(event.reason || "Unhandled promise rejection");
    recordDiagnostic("error", reason, { stack: event.reason?.stack || "" });
    if (typeof toast === "function") toast("A background operation failed. Check diagnostics for details.");
  });
}

const SUPABASE_AUTH_OPTIONS = {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    flowType: "pkce",
    storage: {
      getItem: (key) => safeStorageGet(localStorage, key),
      setItem: (key, value) => safeStorageSet(localStorage, key, value),
      removeItem: (key) => safeStorageRemove(localStorage, key)
    }
  }
};

function initSupabase() {
  const config = window.SUPABASE_CONFIG;
  if (!config || !config.url || !config.anonKey) {
    console.warn("Supabase config missing. Copy .env.example to .env, then run: node scripts/generate-config.js");
    setAuthStatus("Supabase config missing. Set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify.", "error");
    return false;
  }
  if (!window.supabase?.createClient) {
    console.warn("Supabase JS library failed to load.");
    setAuthStatus("Could not load Supabase. Check your connection or disable ad blockers.", "error");
    return false;
  }
  try {
    supabaseConfig = config;
    supabaseClient = window.supabase.createClient(config.url, config.anonKey, SUPABASE_AUTH_OPTIONS);
    return true;
  } catch (error) {
    console.error("Supabase init failed", error);
    setAuthStatus("Could not connect to Supabase.", "error");
    return false;
  }
}

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024;

const LEGACY_JOURNAL_KEYS = [
  "xau_journal_v6",
  "xau_journal_v5",
  "skippedTrades",
  "xau_journal_accounts_v1"
];
const DEFAULT_ACCOUNT_ID = "main";
const DEFAULT_MENTOR_MODEL = "openrouter/auto";

const FIXED = {
  sessions: ["Pre-Asian (3am-5am)", "Asian (5am-8am)", "Post-Asian (8am-10am)", "Pre-London (10am-12pm)", "London (12pm-2pm)", "Post-London (2pm-4pm)", "Pre-NY (4pm-5pm)", "New York (5pm-8pm)", "Post-NY (8pm-3am)"],
  levels: ["SBR/TJL1", "RBS/TJL1", "TJL2", "QML", "FIB", "LVL4", "LVL2"],
  tfs: ["1m", "5m", "15m", "H1", "4H"],
  setups: ["A+", "A", "B"],
  mistakes: ["No mistake", "Early entry", "Late entry", "SL too tight", "Fear exit", "FOMO trade", "Not Booking Profit", "Overtrading", "Not following plan"],
  holds: ["Held full TP", "Partial + runner", "Early exit", "SL hit", "RiskFree"],
  marketConditions: ["Bullish", "Bearish", "Ranging", "Choppy"],
  biasAlignments: ["With Trend", "Counter Trend"],
  confirmationTypes: ["BOS", "CHoCH", "Engulfing", "Pin Bar", "Rejection Wick", "Impulse Entry", "None"],
  slPlacements: ["Above CC", "Below CC", "Fixed $", "Below Zone", "Above Zone"],
  tpPlacements: ["Fixed 70 to 100pips", "Below Zone", "Above Zone", "Open TP", "Manually Exit"],
  skipReasons: [
    "Fear - H1/15m too slow",
    "Fear - SL looked too big",
    "No confirmation candle",
    "Wrong session timing",
    "Already missed entry",
    "Distracted / not focused",
    "Low confidence in level",
    "lack of confidence",
    "Market is too fast",
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
  slPlacements: { label: "SL Placement" },
  tpPlacements: { label: "TP Placement" },
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
  selectedDate: null
};

let modalEditingIndex = null;
let cashEditingIndex = null;
let cashModalType = "deposit";
let skippedEditingIndex = null;
let viewTradeIndex = null;
let analysisTimer = null;
let currentUser = null;
let screenshotUploadToken = 0;
let mentorSessionKey = "";

let mentorRequestInProgress = false;
let lastMentorRequestTime = 0;
const MENTOR_COOLDOWN_MS = 30000; // 30 seconds between requests
let accountSwitchInProgress = false;

const screenshotState = {
  url: "",
  previewUrl: "",
  objectUrl: "",
  status: "idle",
  error: ""
};

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
    cashTransactions: [],
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
  const timestamp = Date.now().toString(36);
  const random = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6);
  return `${prefix}_${timestamp}_${random}`;
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
    ownerUid: currentUser?.id || data.ownerUid || "",
    trades: Array.isArray(data.trades) ? data.trades.map(normalizeTrade) : [],
    cashTransactions: Array.isArray(data.cashTransactions) ? data.cashTransactions.map(normalizeCashTransaction) : [],
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
  return (data.trades?.length || 0) + (data.cashTransactions?.length || 0) + (data.skippedTrades?.length || 0) + (data.weeklyReviews?.length || 0);
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
    cashTransactions: mergeRows(baseState.cashTransactions, incomingState.cashTransactions),
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

function purgeLegacyJournalStorage() {
  try {
    LEGACY_JOURNAL_KEYS.forEach((key) => safeStorageRemove(localStorage, key));
    // Note: sb- (Supabase auth) keys are intentionally kept in localStorage for session persistence
  } catch (error) {
    console.warn("Could not purge legacy browser storage", error);
  }
}

function syncMemoryState() {
  if (currentUser) state.ownerUid = currentUser.id;
  state = normalizeJournalState(state);
  if (!accounts.length) accounts = [defaultAccount()];
  if (!accounts.some((account) => account.id === activeAccountId)) activeAccountId = accounts[0].id;
  accountData[activeAccountId] = clone(state);
}

function resetJournalState(ownerUid = "") {
  accounts = [defaultAccount()];
  accountData = {};
  activeAccountId = DEFAULT_ACCOUNT_ID;
  state = emptyJournalState(ownerUid);
  accountData[activeAccountId] = clone(state);
  mentorSessionKey = "";
}

function clearSessionAuthStorage() {
  try {
    safeStorageClearMatching(localStorage, (key) => key.startsWith("sb-") || key === "supabase.auth.token" || key.startsWith("gj_session_"));
    safeStorageClearMatching(sessionStorage, (key) => key.startsWith("sb-") || key === "supabase.auth.token" || key.startsWith("gj_"));
  } catch (error) {
    console.warn("Could not clear auth storage", error);
  }
}

function normalizeOptions(options) {
  const next = clone(FIXED);
  Object.keys(FIXED).forEach((key) => {
    const legacyValues = key === "slPlacements" && Array.isArray(options.slTpPlacements) ? options.slTpPlacements : [];
    const sourceValues = Array.isArray(options[key]) ? options[key] : legacyValues;
    const custom = sourceValues.map((value) => key === "tpPlacements" ? String(value || "").trim() : normalizeUnitLabel(value));
    next[key] = Array.from(new Set([...FIXED[key], ...custom].filter(Boolean)));
  });
  return next;
}

function normalizeUnitLabel(value) {
  return String(value || "").replace(/\bpips\b/gi, "$");
}

function normalizeCashTransaction(entry = {}) {
  const type = String(entry.type || "").toLowerCase() === "withdraw" ? "withdraw" : "deposit";
  const amount = round1(Math.abs(parseFloat(entry.amount) || 0));
  return {
    id: entry.id || generateId("cash"),
    date: entry.date || "",
    type,
    amount: amount || "",
    note: entry.note || entry.reason || "",
    createdAt: entry.createdAt || new Date().toISOString()
  };
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
    tpPlacement: String(trade.tpPlacement || "").trim(),
    patienceScore: normalizePatienceScore(trade.patienceScore),
    risk: trade.risk || "",
    reward: trade.reward || "",
    result: trade.result || "",
    reason: trade.reason || trade.notes || "",
    screenshotUrl: safeHttpUrl(trade.screenshotUrl),
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

function openJournalDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("GoldJournalOffline", 2);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("backups")) {
        db.createObjectStore("backups", { keyPath: "key" });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

function buildBackupChecksum(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function isBackupEntryValid(entry) {
  return entry && typeof entry === "object" && entry.data && typeof entry.updatedAt === "string" && typeof entry.checksum === "string";
}

async function saveToIndexedDB(userId, accountId, data) {
  try {
    const db = await openJournalDB();
    const tx = db.transaction("backups", "readwrite");
    const store = tx.objectStore("backups");
    const key = `${userId || "anonymous"}_${accountId}`;
    const snapshot = {
      key,
      data: clone(data),
      updatedAt: new Date().toISOString(),
      checksum: buildBackupChecksum(data),
      version: 2
    };
    const existingRequest = store.get(key);
    return new Promise((resolve, reject) => {
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result || {};
        const history = Array.isArray(existing.history) ? existing.history.filter(isBackupEntryValid) : [];
        history.unshift(snapshot);
        history.splice(5);
        store.put({ key, history, latest: snapshot, updatedAt: snapshot.updatedAt });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      existingRequest.onerror = () => reject(existingRequest.error);
    });
  } catch (err) {
    console.warn("Failed to save to IndexedDB", err);
    recordDiagnostic("error", "Local backup save failed", { accountId, error: String(err?.message || err) });
  }
}

async function loadFromIndexedDB(userId, accountId) {
  try {
    const db = await openJournalDB();
    const tx = db.transaction("backups", "readonly");
    const store = tx.objectStore("backups");
    const key = `${userId || "anonymous"}_${accountId}`;
    const request = store.get(key);
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const result = request.result;
        const latest = result?.latest;
        const history = Array.isArray(result?.history) ? result.history : [];
        const candidates = [latest, ...history].filter(isBackupEntryValid);
        const validCandidate = candidates.find((entry) => entry.checksum === buildBackupChecksum(entry.data));
        resolve(validCandidate?.data || result?.data || null);
      };
      request.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn("Failed to load from IndexedDB", err);
    return null;
  }
}

async function save() {
  if (!activeAccountId || !accounts.some((a) => a.id === activeAccountId)) {
    console.warn("save() aborted: no valid active account.");
    return;
  }
  syncMemoryState();
  renderAccountSelector();

  // Save to offline local backup
  await saveToIndexedDB(currentUser?.id, activeAccountId, state);
  await saveToIndexedDB(currentUser?.id, "accounts_list", accounts);

  if (!currentUser || !supabaseReady) {
    toast("Saved locally (offline mode).");
    updateSyncStatus("offline");
    return;
  }
  try {
    await saveToSupabase();
  } catch (error) {
    console.warn("Could not sync to Supabase", error);
    updateSyncStatus("offline");
    toast("Sync failed. Saved locally (offline backup).");
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
  const hour = (new Date().getUTCHours() + 5) % 24;
  if (hour >= 3 && hour < 5) return "Pre-Asian (3am-5am)";
  if (hour >= 5 && hour < 8) return "Asian (5am-8am)";
  if (hour >= 8 && hour < 10) return "Post-Asian (8am-10am)";
  if (hour >= 10 && hour < 12) return "Pre-London (10am-12pm)";
  if (hour >= 12 && hour < 14) return "London (12pm-2pm)";
  if (hour >= 14 && hour < 16) return "Post-London (2pm-4pm)";
  if (hour >= 16 && hour < 17) return "Pre-NY (4pm-5pm)";
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

function accountBalanceSummary() {
  recalcCum();
  const deposits = round1((state.cashTransactions || [])
    .filter((entry) => entry.type === "deposit")
    .reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0));
  const withdrawals = round1((state.cashTransactions || [])
    .filter((entry) => entry.type === "withdraw")
    .reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0));
  const tradePnl = performance().totalPnl;
  const currentBalance = round1(deposits - withdrawals + tradePnl);
  return { deposits, withdrawals, tradePnl, currentBalance, netFunding: round1(deposits - withdrawals) };
}

function ledgerEvents() {
  const events = [];
  state.trades.forEach((trade, index) => {
    events.push({ kind: "trade", trade, index, date: trade.date || "", createdAt: trade.date || "" });
  });
  (state.cashTransactions || []).forEach((cash, index) => {
    events.push({ kind: "cash", cash, index, date: cash.date || "", createdAt: cash.createdAt || cash.date || "" });
  });
  events.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const chronological = events.slice().reverse();
  let balance = 0;
  const balanceAfter = new WeakMap();
  chronological.forEach((event) => {
    if (event.kind === "cash") {
      const amount = parseFloat(event.cash.amount) || 0;
      balance = round1(balance + (event.cash.type === "deposit" ? amount : -amount));
    } else {
      const pnl = calcPnl(event.trade.risk, event.trade.reward, event.trade.result);
      if (pnl !== "") balance = round1(balance + parseFloat(pnl));
    }
    balanceAfter.set(event, balance);
  });
  events.forEach((event) => {
    event.balanceAfter = balanceAfter.get(event);
  });
  return events;
}

function filteredLedgerEvents() {
  const search = document.getElementById("search-input")?.value.trim().toLowerCase() || "";
  const result = document.getElementById("result-filter")?.value || "";
  return ledgerEvents().filter((event) => {
    if (event.kind === "cash") {
      if (result && result !== "OPEN" && result !== "DEPOSIT" && result !== "WITHDRAW") return false;
      if (result === "DEPOSIT" && event.cash.type !== "deposit") return false;
      if (result === "WITHDRAW" && event.cash.type !== "withdraw") return false;
      if (result === "WIN" || result === "LOSS" || result === "BE") return false;
      if (!search) return true;
      const haystack = [event.cash.date, event.cash.type, event.cash.amount, event.cash.note].join(" ").toLowerCase();
      return haystack.includes(search);
    }
    const trade = event.trade;
    if (result === "OPEN" && trade.result) return false;
    if (result === "DEPOSIT" || result === "WITHDRAW") return false;
    if (result && result !== "OPEN" && trade.result !== result) return false;
    const session = document.getElementById("session-filter")?.value || "";
    const setup = document.getElementById("setup-filter")?.value || "";
    if (session && trade.session !== session) return false;
    if (setup && trade.setup !== setup) return false;
    if (!search) return true;
    const haystack = [trade.date, trade.session, trade.entry, trade.level, trade.tf, trade.setup, trade.mistake, trade.hold, trade.marketCondition, trade.biasAlignment, trade.confirmationType, trade.slTpPlacement, trade.tpPlacement, trade.patienceScore, trade.result, trade.reason].join(" ").toLowerCase();
    return haystack.includes(search);
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

function safeHttpUrl(value, allowBlob = false) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, window.location.origin);
    const allowed = allowBlob ? ["http:", "https:", "blob:"] : ["http:", "https:"];
    return allowed.includes(parsed.protocol) ? parsed.href : "";
  } catch (error) {
    return "";
  }
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
  const balance = accountBalanceSummary();
  const strip = document.getElementById("summary-strip");
  if (strip) {
    strip.innerHTML = [
      metric("Account Balance", `${signed(balance.currentBalance)} $`, `${signed(balance.netFunding)} $ funded + ${signed(balance.tradePnl)} $ trades`, moneyClass(balance.currentBalance)),
      metric("Deposits", `${signed(balance.deposits)} $`, "total funded in", "pos"),
      metric("Withdrawals", `${signed(balance.withdrawals)} $`, "total taken out", balance.withdrawals ? "neg" : "neutral"),
      metric("Closed Trades", p.closed.length, `${open} open`),
      metric("Win Rate", `${p.winRate.toFixed(1)}%`, `${p.wins.length}W / ${p.losses.length}L`, p.winRate >= 50 ? "pos" : "neg"),
      metric("Trade P&L", `${signed(p.totalPnl)} $`, "closed trades only", moneyClass(p.totalPnl))
    ].join("");
  }

  const sidebar = document.getElementById("sidebar-stats");
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="stat-row"><span class="stat-label">Balance</span><span class="stat-val ${moneyClass(balance.currentBalance)}">${signed(balance.currentBalance)}</span></div>
      <div class="stat-row"><span class="stat-label">Trades</span><span class="stat-val gold">${p.closed.length}</span></div>
      <div class="stat-row"><span class="stat-label">Win Rate</span><span class="stat-val ${p.winRate >= 50 ? "pos" : "neg"}">${p.winRate.toFixed(0)}%</span></div>
      <div class="stat-row"><span class="stat-label">Trade P&L</span><span class="stat-val ${moneyClass(p.totalPnl)}">${signed(p.totalPnl)}</span></div>
      <div class="stat-row"><span class="stat-label">Best Level</span><span class="stat-val gold">${escapeHtml(bestLevel || "-")}</span></div>
    `;
  }

  const sub = document.getElementById("log-sub");
  if (sub) {
    const cashCount = (state.cashTransactions || []).length;
    sub.textContent = `${state.trades.length} trades, ${cashCount} cash entries, ${p.closed.length} closed, ${p.winRate.toFixed(0)}% win rate · Balance ${signed(balance.currentBalance)} $.`;
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
  state = emptyJournalState(currentUser?.id || "");
  accountData[activeAccountId] = clone(state);
  try {
    syncMemoryState();
    if (currentUser && supabaseReady) await save();
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
    syncMemoryState();
    if (currentUser && supabaseReady) await save();
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
  if (accountSwitchInProgress) {
    toast("Account switch in progress. Please wait.");
    // Reset selector to current account
    const select = document.getElementById("account-select");
    if (select) select.value = activeAccountId;
    return;
  }
  accountSwitchInProgress = true;
  const nextAccount = accounts.find((account) => account.id === accountId);
  if (!nextAccount) {
    accountSwitchInProgress = false;
    return;
  }
  try {
    await save();
    activeAccountId = accountId;
    state = normalizeJournalState(accountData[activeAccountId] || emptyJournalState());
    syncMemoryState();
    renderCurrentAccount();
    toast(`${nextAccount.name} loaded.`);
  } catch (error) {
    console.warn("Could not switch account", error);
    updateSyncStatus("offline");
    toast("Account switch failed.");
  } finally {
    accountSwitchInProgress = false;
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
      const haystack = [trade.date, trade.session, trade.entry, trade.level, trade.tf, trade.setup, trade.mistake, trade.hold, trade.marketCondition, trade.biasAlignment, trade.confirmationType, trade.slTpPlacement, trade.tpPlacement, trade.patienceScore, trade.result, trade.reason].join(" ").toLowerCase();
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

  const hasEntries = state.trades.length || (state.cashTransactions || []).length;
  if (!hasEntries) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="23">
          <div class="empty-state onboarding-state">
            <div class="onboarding-card">
              <i data-lucide="clipboard-plus"></i>
              <strong>Start your journal</strong>
              <span>Log a deposit to set your starting balance, then add trades. Withdrawals track real account payouts.</span>
              <div class="onboarding-actions">
                <button class="soft-btn deposit-btn" onclick="openCashModal('deposit')"><i data-lucide="arrow-down-to-line"></i><span>Deposit</span></button>
                <button class="primary-btn" onclick="addTrade()"><i data-lucide="plus"></i><span>New Trade</span></button>
                <button class="soft-btn" onclick="seedDemoTrades()"><i data-lucide="sparkles"></i><span>Load demo data</span></button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
    refreshIcons();
    return;
  }

  const rows = filteredLedgerEvents();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="23"><div class="empty-state"><div><strong>No matching entries</strong><span>Clear filters to see the full journal.</span></div></div></td></tr>`;
    refreshIcons();
    return;
  }

  rows.forEach((event, displayIndex) => {
    if (event.kind === "cash") {
      tbody.appendChild(renderCashRow(event, displayIndex));
      return;
    }
    const { trade, index } = event;
    const tr = document.createElement("tr");
    tr.className = trade.result === "WIN" ? "row-win" : trade.result === "LOSS" ? "row-loss" : trade.result === "BE" ? "row-be" : "";
    tr.classList.add("clickable-row");
    tr.addEventListener("click", (clickEvent) => {
      if (clickEvent.target.closest("button, input, select, textarea, a")) return;
      openViewTradeModal(index);
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
    tr.appendChild(displayCell("SL", trade.slTpPlacement || "-", "wrap-text optional-col"));
    tr.appendChild(displayCell("TP", trade.tpPlacement || "-", "wrap-text optional-col"));
    tr.appendChild(htmlCell("Patience", patienceBadge(index, trade.patienceScore)));
    tr.appendChild(displayCell("Risk", trade.risk || "-", "mono"));
    tr.appendChild(displayCell("Reward", trade.reward || "-", "mono"));
    tr.appendChild(htmlCell("RR", `<span class="rr">${escapeHtml(calcRR(trade.risk, trade.reward) || "-")}</span>`));
    tr.appendChild(htmlCell("Result", valuePill(trade.result, "result")));
    tr.appendChild(htmlCell("P&L", pnlHtml(trade.pnl)));
    tr.appendChild(htmlCell("Balance", pnlHtml(event.balanceAfter)));
    tr.appendChild(displayCell("Notes", trade.reason || "-", "notes-preview"));
    tr.appendChild(actionCell("Actions", index));
    tbody.appendChild(tr);
  });

  refreshIcons();
}

function renderCashRow(event, displayIndex) {
  const { cash, index } = event;
  const tr = document.createElement("tr");
  tr.className = cash.type === "deposit" ? "row-deposit" : "row-withdraw";
  tr.classList.add("cash-row");
  const amount = parseFloat(cash.amount) || 0;
  tr.appendChild(textCell("#", `C${index + 1}`, "row-num cash-num"));
  tr.appendChild(displayCell("Date", formatDateDisplay(cash.date) || "-", "date-display"));
  tr.appendChild(htmlCell("Session", valuePill(cash.type === "deposit" ? "DEPOSIT" : "WITHDRAW", cash.type === "deposit" ? "result" : "result")));
  tr.appendChild(htmlCell("Side", `<span class="table-pill pill-cash pill-${cash.type}">${cash.type === "deposit" ? "Deposit" : "Withdraw"}</span>`));
  tr.appendChild(displayCell("Level", "—", "muted-cell"));
  tr.appendChild(displayCell("TF", "—", "muted-cell"));
  tr.appendChild(displayCell("Setup", "—", "muted-cell"));
  tr.appendChild(displayCell("Mistake", "—", "muted-cell"));
  tr.appendChild(displayCell("Hold", "—", "muted-cell"));
  tr.appendChild(displayCell("Market", "—", "muted-cell optional-col"));
  tr.appendChild(displayCell("Bias", "—", "muted-cell optional-col"));
  tr.appendChild(displayCell("Confirm", "—", "muted-cell optional-col"));
  tr.appendChild(displayCell("SL", "—", "muted-cell optional-col"));
  tr.appendChild(displayCell("TP", "—", "muted-cell optional-col"));
  tr.appendChild(displayCell("Patience", "—", "muted-cell"));
  tr.appendChild(displayCell("Risk", "—", "muted-cell"));
  tr.appendChild(displayCell("Reward", "—", "muted-cell"));
  tr.appendChild(displayCell("RR", "—", "muted-cell"));
  tr.appendChild(htmlCell("Result", valuePill(cash.type === "deposit" ? "DEPOSIT" : "WITHDRAW", "result")));
  tr.appendChild(htmlCell("P&L", pnlHtml(cash.type === "deposit" ? amount : -amount)));
  tr.appendChild(htmlCell("Balance", pnlHtml(event.balanceAfter)));
  tr.appendChild(displayCell("Notes", cash.note || "-", "notes-preview"));
  tr.appendChild(cashActionCell("Actions", index));
  return tr;
}

function cashActionCell(label, index) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.className = "action-cell";
  const edit = document.createElement("button");
  edit.className = "icon-btn";
  edit.title = "Edit entry";
  edit.innerHTML = `<i data-lucide="pencil"></i>`;
  edit.addEventListener("click", () => openCashModal(state.cashTransactions[index]?.type || "deposit", index));
  const del = document.createElement("button");
  del.className = "icon-btn";
  del.title = "Delete entry";
  del.innerHTML = `<i data-lucide="trash-2"></i>`;
  del.addEventListener("click", () => deleteCashTransaction(index));
  td.appendChild(edit);
  td.appendChild(del);
  return td;
}

function openCashModal(type = "deposit", index = null) {
  cashModalType = type === "withdraw" ? "withdraw" : "deposit";
  cashEditingIndex = Number.isInteger(index) ? index : null;
  const modal = document.getElementById("cash-modal");
  const title = document.getElementById("cash-modal-title");
  const saveBtn = document.getElementById("cash-save-btn");
  const entry = Number.isInteger(index) ? state.cashTransactions[index] : null;
  if (title) title.textContent = entry ? (cashModalType === "deposit" ? "Edit Deposit" : "Edit Withdrawal") : (cashModalType === "deposit" ? "Add Deposit" : "Add Withdrawal");
  if (saveBtn) saveBtn.textContent = entry ? "Save Changes" : cashModalType === "deposit" ? "Save Deposit" : "Save Withdrawal";
  document.getElementById("cash-date").value = entry?.date || todayISO();
  document.getElementById("cash-amount").value = entry?.amount || "";
  document.getElementById("cash-note").value = entry?.note || "";
  modal?.removeAttribute("hidden");
  setTimeout(() => document.getElementById("cash-amount")?.focus(), 40);
  refreshIcons();
}

function closeCashModal() {
  document.getElementById("cash-modal")?.setAttribute("hidden", "");
  cashEditingIndex = null;
}

function saveCashFromModal() {
  const date = document.getElementById("cash-date")?.value || todayISO();
  const amount = round1(Math.abs(parseFloat(document.getElementById("cash-amount")?.value) || 0));
  const note = document.getElementById("cash-note")?.value.trim() || "";
  if (!amount) {
    toast("Enter a valid amount.");
    return;
  }
  const entry = normalizeCashTransaction({
    id: Number.isInteger(cashEditingIndex) ? state.cashTransactions[cashEditingIndex]?.id : undefined,
    date,
    type: cashModalType,
    amount,
    note,
    createdAt: Number.isInteger(cashEditingIndex) ? state.cashTransactions[cashEditingIndex]?.createdAt : new Date().toISOString()
  });
  if (!state.cashTransactions) state.cashTransactions = [];
  if (Number.isInteger(cashEditingIndex)) {
    state.cashTransactions[cashEditingIndex] = entry;
    toast(cashModalType === "deposit" ? "Deposit updated." : "Withdrawal updated.");
  } else {
    state.cashTransactions.push(entry);
    toast(cashModalType === "deposit" ? "Deposit saved." : "Withdrawal saved.");
  }
  save();
  closeCashModal();
  renderTrades();
  if (document.getElementById("tab-pnl")?.classList.contains("active")) renderPnl();
}

function deleteCashTransaction(index) {
  const entry = state.cashTransactions[index];
  if (!entry) return;
  const label = entry.type === "deposit" ? "deposit" : "withdrawal";
  if (!confirm(`Delete this ${label} of ${signed(entry.amount)} $?`)) return;
  state.cashTransactions.splice(index, 1);
  save();
  renderTrades();
  toast(`${label.charAt(0).toUpperCase()}${label.slice(1)} deleted.`);
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
  const trade = state.trades[index] || {};
  const view = document.createElement("button");
  view.className = `icon-btn view-trade-btn${trade.screenshotUrl ? " has-screenshot" : ""}`;
  view.title = trade.screenshotUrl ? "View trade with screenshot" : "View trade";
  view.innerHTML = `<i data-lucide="eye"></i>${trade.screenshotUrl ? `<span class="screenshot-dot" aria-hidden="true"></span>` : ""}`;
  view.addEventListener("click", () => openViewTradeModal(index));
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
  td.appendChild(view);
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

function resetScreenshotObjectUrl() {
  if (screenshotState.objectUrl) {
    URL.revokeObjectURL(screenshotState.objectUrl);
    screenshotState.objectUrl = "";
  }
}

function setScreenshotState(next = {}) {
  Object.assign(screenshotState, next);
  renderScreenshotUploader();
}

function initScreenshotUploader(trade = {}) {
  screenshotUploadToken += 1;
  resetScreenshotObjectUrl();
  screenshotState.url = trade.screenshotUrl || "";
  screenshotState.previewUrl = trade.screenshotUrl || "";
  screenshotState.status = "idle";
  screenshotState.error = "";
  renderScreenshotUploader();
}

function renderScreenshotUploader() {
  const preview = document.getElementById("modal-screenshot-preview");
  const status = document.getElementById("modal-screenshot-status");
  const dropzone = document.getElementById("modal-screenshot-dropzone");
  if (!preview || !status || !dropzone) return;

  dropzone.classList.toggle("is-uploading", screenshotState.status === "uploading");

  const saveBtn = document.getElementById("modal-save-trade-btn");
  if (saveBtn) {
    saveBtn.disabled = screenshotState.status === "uploading";
    saveBtn.title = screenshotState.status === "uploading" ? "Waiting for screenshot upload to finish" : "";
  }
  const statusText = {
    idle: screenshotState.url ? "Uploaded" : "",
    preview: "Preview ready",
    uploading: "Uploading...",
    uploaded: "Uploaded",
    error: screenshotState.error || "Upload failed"
  }[screenshotState.status] || "";
  status.innerHTML = screenshotState.status === "uploading"
    ? `<span class="upload-spinner" aria-hidden="true"></span>${escapeHtml(statusText)}`
    : (statusText === "Uploaded" ? `&#10003; ${escapeHtml(statusText)}` : escapeHtml(statusText));

  if (!screenshotState.previewUrl) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }

  preview.hidden = false;
  const previewUrl = safeHttpUrl(screenshotState.previewUrl, true) || screenshotState.previewUrl;
  preview.innerHTML = `
    <div class="screenshot-preview-frame">
      <img src="${escapeHtml(previewUrl)}" alt="Trade screenshot preview" referrerpolicy="no-referrer">
      <button class="icon-btn screenshot-remove" type="button" onclick="removeTradeScreenshot()" title="Remove screenshot" aria-label="Remove screenshot">
        <i data-lucide="x"></i>
      </button>
    </div>
  `;
  refreshIcons();
}

function removeTradeScreenshot() {
  screenshotUploadToken += 1;
  resetScreenshotObjectUrl();
  setScreenshotState({ url: "", previewUrl: "", status: "idle", error: "" });
  const input = document.getElementById("modal-screenshot-input");
  if (input) input.value = "";
}

async function handleScreenshotFile(file) {
  if (!file) return;
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  const fileExt = "." + (file.name.split(".").pop() || "").toLowerCase();

  if (!file.type || !ALLOWED_IMAGE_TYPES.includes(file.type)) {
    toast("Only JPG, PNG, WebP, or GIF files are allowed.");
    return;
  }
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(fileExt)) {
    toast("File extension not allowed. Use .jpg, .png, .webp, or .gif.");
    return;
  }
  if (file.size > MAX_SCREENSHOT_SIZE) {
    toast("Image too large (max 5MB)");
    return;
  }

  resetScreenshotObjectUrl();
  const uploadToken = screenshotUploadToken + 1;
  screenshotUploadToken = uploadToken;
  const localUrl = URL.createObjectURL(file);
  setScreenshotState({ url: "", previewUrl: localUrl, objectUrl: localUrl, status: "uploading", error: "" });

  if (!supabaseClient || !currentUser) {
    toast("Sign in required to upload screenshots.");
    setScreenshotState({ status: "error", error: "Not signed in" });
    return;
  }

  try {
    const ext = file.name.split(".").pop() || "jpg";
    const filePath = `${currentUser.id}/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("screenshots")
      .upload(filePath, file, { cacheControl: "3600", upsert: false });

    if (uploadError) throw uploadError;
    if (uploadToken !== screenshotUploadToken) return;

    const { data: { publicUrl } } = supabaseClient.storage
      .from("screenshots")
      .getPublicUrl(filePath);

    resetScreenshotObjectUrl();
    setScreenshotState({
      url: publicUrl,
      previewUrl: publicUrl,
      objectUrl: "",
      status: "uploaded",
      error: ""
    });
  } catch (error) {
    if (uploadToken !== screenshotUploadToken) return;
    console.warn("Screenshot upload failed", error);
    toast("Screenshot upload failed. Retry or remove it before saving.");
    setScreenshotState({ url: "", status: "error", error: "Upload failed" });
  }
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
  fillModalSelect("modal-sl-tp-placement", state.options.slPlacements, "Select", "slPlacements");
  fillModalSelect("modal-tp-placement", state.options.tpPlacements, "Select", "tpPlacements");

  const trade = draft || (modalEditingIndex === null ? newTradeTemplate() : state.trades[modalEditingIndex]);
  const title = document.getElementById("trade-modal-title");
  if (title) title.textContent = modalEditingIndex === null ? "New Trade" : `Edit Trade #${modalEditingIndex + 1}`;
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
  setModalValue("modal-tp-placement", trade.tpPlacement);
  setModalValue("modal-patience-score", trade.patienceScore);
  setModalValue("modal-risk", trade.risk);
  setModalValue("modal-reward", trade.reward);
  setModalValue("modal-reason", trade.reason);
  initScreenshotUploader(trade);

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
  screenshotUploadToken += 1;
  resetScreenshotObjectUrl();
  // Reset screenshot state fully on close to avoid stale preview
  screenshotState.url = "";
  screenshotState.previewUrl = "";
  screenshotState.status = "idle";
  screenshotState.error = "";
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
    tpPlacement: document.getElementById("modal-tp-placement")?.value || "",
    patienceScore: normalizePatienceScore(document.getElementById("modal-patience-score")?.value || ""),
    risk: document.getElementById("modal-risk")?.value || "",
    reward: document.getElementById("modal-reward")?.value || "",
    result: document.getElementById("modal-result")?.value || "",
    reason: document.getElementById("modal-reason")?.value || "",
    screenshotUrl: screenshotState.url || ""
  });
}

function saveTradeFromModal() {
  if (screenshotState.status === "uploading") {
    toast("Screenshot still uploading - please wait a moment and save again.");
    return;
  }
  if (screenshotState.status === "error" && screenshotState.previewUrl && !screenshotState.url) {
    toast("Screenshot is not uploaded. Retry upload or remove it before saving.");
    return;
  }
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
  const trade = state.trades[index];
  if (!trade) return;
  if (!confirm(`Delete trade #${index + 1} (${trade.date || "no date"} · ${trade.result || "open"})? This cannot be undone.`)) return;
  const tradeId = trade.id;
  state.trades.splice(index, 1);
  save();
  renderTrades();
  if (document.getElementById("tab-pnl")?.classList.contains("active")) renderPnl();
  if (tradeId) deleteTradeFromSupabase(tradeId);
  toast("Trade deleted.");
}

function openViewTradeModal(index) {
  viewTradeIndex = Number.isInteger(index) ? index : null;
  const modal = document.getElementById("view-trade-modal");
  if (!modal || viewTradeIndex === null || !state.trades[viewTradeIndex]) return;
  renderViewTradeModal();
  modal.hidden = false;
  document.body.classList.add("modal-open");
  refreshIcons();
}

function closeViewTradeModal() {
  const modal = document.getElementById("view-trade-modal");
  if (modal) modal.hidden = true;
  viewTradeIndex = null;
  if (document.getElementById("trade-modal")?.hidden !== false && document.getElementById("skipped-modal")?.hidden !== false) {
    document.body.classList.remove("modal-open");
  }
}

function editTradeFromView() {
  const index = viewTradeIndex;
  closeViewTradeModal();
  if (Number.isInteger(index)) openTradeModal(index);
}

function viewBadge(value, type) {
  const key = String(value || "empty").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `<span class="view-badge badge-${type} badge-${key || "empty"}">${escapeHtml(value || "-")}</span>`;
}

function readonlyStars(score) {
  const current = Math.max(0, Math.min(5, parseInt(score, 10) || 0));
  return `<span class="star-rating-readonly" aria-label="${current} out of 5">${"&#9733;".repeat(current)}${"&#9734;".repeat(5 - current)}</span>`;
}

function viewInfoItem(label, value, delay) {
  return `
    <div class="view-info-item" style="animation-delay:${delay}ms">
      <span>${escapeHtml(label)}</span>
      <b>${value || "-"}</b>
    </div>
  `;
}

function renderViewTradeModal() {
  const trade = state.trades[viewTradeIndex];
  const body = document.getElementById("view-trade-body");
  const title = document.getElementById("view-trade-title");
  if (!trade || !body) return;
  if (title) title.textContent = `Trade #${viewTradeIndex + 1}`;
  const pnl = calcPnl(trade.risk, trade.reward, trade.result);
  const pnlText = pnl === "" ? "- $" : `${signed(pnl)} $`;
  const info = [
    ["Session", escapeHtml(trade.session || "-")],
    ["Level", escapeHtml(trade.level || "-")],
    ["Timeframe", escapeHtml(trade.tf || "-")],
    ["Setup Quality", escapeHtml(trade.setup || "-")],
    ["Market Condition", escapeHtml(trade.marketCondition || "-")],
    ["Trade Direction vs Bias", escapeHtml(trade.biasAlignment || "-")],
    ["Confirmation Type", escapeHtml(trade.confirmationType || "-")],
    ["SL Placement", escapeHtml(trade.slTpPlacement || "-")],
    ["TP Placement", escapeHtml(trade.tpPlacement || "-")],
    ["Mistake Type", escapeHtml(trade.mistake || "-")],
    ["Hold Quality", escapeHtml(trade.hold || "-")],
    ["Risk ($)", escapeHtml(trade.risk || "-")],
    ["Reward ($)", escapeHtml(trade.reward || "-")],
    ["Patience Score", readonlyStars(trade.patienceScore)]
  ];
  const screenshotUrl = safeHttpUrl(trade.screenshotUrl);
  const imageHtml = screenshotUrl
    ? `<a class="view-image-link" href="${escapeHtml(screenshotUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="Open screenshot full size">
        <img class="view-image" src="${escapeHtml(screenshotUrl)}" alt="Trade screenshot" referrerpolicy="no-referrer" onload="this.classList.add('is-loaded')" onerror="this.classList.add('is-loaded')">
      </a>`
    : `<div class="view-image-placeholder">
        <i data-lucide="image-off"></i>
        <strong>No screenshot added</strong>
        <button class="link-btn" type="button" onclick="editTradeFromView()">Add Screenshot</button>
      </div>`;

  body.innerHTML = `
    <article class="view-card">
      ${imageHtml}
      <header class="view-header">
        <div class="view-header-meta">
          <span>${escapeHtml(formatDateDisplay(trade.date) || "-")}</span>
          ${viewBadge(trade.result, "result")}
          ${viewBadge(trade.entry, "side")}
        </div>
        <div class="view-rr">
          <b>${escapeHtml(calcRR(trade.risk, trade.reward) || "-")}</b>
          <span class="${moneyClass(pnl)}">${escapeHtml(pnlText)}</span>
        </div>
      </header>
      <div class="view-info-grid">
        ${info.map(([label, value], itemIndex) => viewInfoItem(label, value, itemIndex * 20)).join("")}
      </div>
      <section class="view-notes">
        <span>Notes / Reason</span>
        <p>${escapeHtml(trade.reason || "No notes added")}</p>
      </section>
      <footer class="view-footer">
        <button class="primary-btn" type="button" onclick="editTradeFromView()"><i data-lucide="pencil"></i><span>Edit Trade</span></button>
        <button class="soft-btn" type="button" onclick="closeViewTradeModal()">Close</button>
      </footer>
    </article>
  `;
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
  if (title) title.textContent = skippedEditingIndex === null ? "Log Skipped Trade" : `Edit Skipped Trade #${skippedEditingIndex + 1}`;
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
  const trade = state.skippedTrades[index];
  if (!trade) return;
  if (!confirm(`Delete skipped trade (${trade.date || "no date"} · ${trade.level || "no level"})? This cannot be undone.`)) return;
  const tradeId = trade.id;
  state.skippedTrades.splice(index, 1);
  save();
  renderSkippedTrades();
  if (tradeId) deleteSkippedFromSupabase(tradeId);
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
      if (outcome) {
        const norm = String(trade.outcome || "").trim().toLowerCase();
        if (outcome === "tp") {
          const isWin = norm.includes("tp hit") || norm.includes("tp");
          if (!isWin) return false;
        } else if (outcome === "sl") {
          const isLoss = norm.includes("sl") || norm.includes("loss");
          if (!isLoss) return false;
        } else if (outcome === "no-reaction") {
          const isNoReact = norm.includes("no reaction") || norm.includes("noreaction");
          if (!isNoReact) return false;
        }
      }
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
  destroyCharts("analysis-");
  const el = document.getElementById("analysis-content");
  if (!el) return;
  const p = performance();
  const streaks = streakStats();
  const hasEquityCurve = state.trades.some((trade) => trade.cum !== "");
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
        ${hasEquityCurve
    ? `<div class="chart-card chart-equity"><canvas id="analysis-equity" aria-label="Equity curve chart"></canvas></div>`
    : `<div class="empty-state" style="min-height:210px"><div><strong>No equity curve yet</strong><span>Close trades to build the curve automatically.</span></div></div>`}
      </div>
      <div class="panel panel-pad">
        <div class="panel-title"><span>Auto Insights</span><span class="section-pill neutral">${p.closed.length} closed</span></div>
        <div class="insight-list">${insightHtml()}</div>
      </div>
    </div>
    <div class="charts-row">
      <div class="chart-card">
        <h4>Win Rate by Level</h4>
        <canvas id="analysis-level-wr" aria-label="Win rate by level"></canvas>
      </div>
      <div class="chart-card">
        <h4>Win Rate by Timeframe</h4>
        <canvas id="analysis-tf-wr" aria-label="Win rate by timeframe"></canvas>
      </div>
    </div>
    <div class="charts-row">
      <div class="chart-card">
        <h4>P&amp;L by Session</h4>
        <canvas id="analysis-session-pnl" aria-label="P and L by session"></canvas>
      </div>
      <div class="chart-card">
        <h4>Mistake Distribution</h4>
        <canvas id="analysis-mistake" aria-label="Mistake distribution"></canvas>
      </div>
    </div>
    <div class="chart-card chart-tall" style="margin-bottom:14px">
      <h4>Rolling 10-Trade Win Rate</h4>
      <canvas id="analysis-rolling-wr" aria-label="Rolling win rate"></canvas>
    </div>
    ${analysisTable("Level Analysis", "levels", "level")}
    ${analysisTable("Timeframe Analysis", "tfs", "tf")}
    ${analysisTable("Session Analysis", "sessions", "session")}
    ${analysisTable("Setup Quality Analysis", "setups", "setup")}
    ${analysisTable("Mistake Type Analysis", "mistakes", "mistake")}
    ${analysisTable("Hold Quality Analysis", "holds", "hold")}
    ${analysisTable("Market Condition Analysis", "marketConditions", "marketCondition")}
    ${analysisTable("Confirmation Type Analysis", "confirmationTypes", "confirmationType")}
    ${analysisTable("SL Placement Analysis", "slPlacements", "slTpPlacement")}
    ${analysisTable("TP Placement Analysis", "tpPlacements", "tpPlacement")}
    ${patienceAnalysis()}
    ${crossTable()}
    ${comboAnalysisTable()}
  `;
  renderAnalysisCharts();
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
  return `Impatient entries cost you ${round1(lowPatienceLoss)} $. Score â‰¥4 trades win ${patienceWinRate((score) => score >= 4)} vs ${patienceWinRate((score) => score <= 2)} for â‰¤2.`;
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

window._charts = window._charts || {};

const MENTOR_SECTION_ICONS = {
  "TRADING REPORT CARD": "ðŸ†",
  "BRUTAL TRUTH": "ðŸ”´",
  "BEHAVIORAL ALERTS": "âš ï¸",
  "WHAT IS WORKING": "âœ…",
  "WHAT IS COSTING MONEY": "ðŸ’¸",
  "BLIND SPOT REPORT": "ðŸ”",
  "MISSED TRADE LESSON": "ðŸ“Œ",
  "NEXT 5-TRADE RULES": "ðŸ“‹",
  "STOP IMMEDIATELY": "ðŸ›‘",
  "REPEAT IMMEDIATELY": "ðŸ”",
  "WEEKEND HOMEWORK": "ðŸ“š"
};

const doughnutCenterTextPlugin = {
  id: "doughnutCenterText",
  beforeDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.length) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    ctx.save();
    ctx.font = "600 13px Inter, sans-serif";
    ctx.fillStyle = "#e8edf5";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Mistakes", (chartArea.left + chartArea.right) / 2, (chartArea.top + chartArea.bottom) / 2);
    ctx.restore();
  }
};

function destroyCharts(prefix = "") {
  Object.keys(window._charts).forEach((key) => {
    if (prefix && !key.startsWith(prefix)) return;
    window._charts[key]?.destroy();
    delete window._charts[key];
  });
}

function destroyAllCharts() {
  destroyCharts();
}

function winRateBarColor(winRate) {
  if (winRate >= 60) return "#3ecf8e";
  if (winRate >= 40) return "#f0bd55";
  return "#f05252";
}

function chartFontColor() {
  return "#e8edf5";
}

function chartGridColor() {
  return "rgba(255,255,255,0.05)";
}

function chartTooltipOptions() {
  return {
    backgroundColor: "#1a2030",
    borderColor: "#f0bd55",
    borderWidth: 1,
    titleColor: "#ffd985",
    bodyColor: "#e8edf5",
    titleFont: { family: "Inter", size: 12 },
    bodyFont: { family: "Inter", size: 12 }
  };
}

function chartLegendOptions(position = "bottom") {
  return {
    position,
    labels: {
      color: chartFontColor(),
      font: { family: "Inter", size: 11 },
      boxWidth: 12,
      padding: 12
    }
  };
}

function chartScaleOptions(showY = true, showX = true) {
  const scales = {};
  if (showY) {
    scales.y = {
      beginAtZero: true,
      ticks: { color: "rgba(232,237,245,0.75)", font: { family: "Inter", size: 10 } },
      grid: { color: chartGridColor() },
      border: { display: false }
    };
  }
  if (showX) {
    scales.x = {
      ticks: { color: "rgba(232,237,245,0.75)", font: { family: "Inter", size: 10 } },
      grid: { color: chartGridColor() },
      border: { display: false }
    };
  }
  return scales;
}

function createChart(id, config) {
  if (typeof Chart === "undefined") return null;
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  if (window._charts[id]) {
    window._charts[id].destroy();
    delete window._charts[id];
  }
  window._charts[id] = new Chart(canvas, config);
  return window._charts[id];
}

function levelWinRateChartData() {
  return grouped("levels", "level").sort((a, b) => b.winRate - a.winRate);
}

function tfWinRateChartData() {
  return grouped("tfs", "tf").sort((a, b) => b.winRate - a.winRate);
}

function equityCurveChartData() {
  recalcCum();
  const closedRows = state.trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => trade.cum !== "");
  return {
    labels: ["Start", ...closedRows.map(({ trade, index }) => `#${index + 1}`)],
    values: [0, ...closedRows.map(({ trade }) => parseFloat(trade.cum))],
    dates: ["", ...closedRows.map(({ trade }) => formatDateDisplay(trade.date) || "")]
  };
}

function sessionPnlChartData() {
  return grouped("sessions", "session")
    .filter((row) => row.count > 0)
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}

function mistakeChartData() {
  return grouped("mistakes", "mistake").filter((row) => row.count > 0 && row.key !== "No mistake");
}

function monthlyPnlChartData() {
  const map = new Map();
  performance().closed.forEach((trade) => {
    if (!trade.date) return;
    const parts = trade.date.split("-");
    const key = `${parts[0]}-${parts[1]}`;
    const monthIndex = parseInt(parts[1], 10) - 1;
    const label = `${DATE_MONTHS[monthIndex]?.slice(0, 3) || parts[1]} ${parts[0]}`;
    if (!map.has(key)) map.set(key, { key, label, pnl: 0, trades: 0 });
    const row = map.get(key);
    row.pnl = round1(row.pnl + (parseFloat(trade.pnl) || 0));
    row.trades += 1;
  });
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function rollingWinRateChartData() {
  const closed = state.trades.filter((trade) => trade.result);
  const labels = [];
  const values = [];
  closed.forEach((trade, index) => {
    const start = Math.max(0, index - 9);
    const window = closed.slice(start, index + 1);
    const wins = window.filter((row) => row.result === "WIN").length;
    labels.push(`#${index + 1}`);
    values.push(window.length ? round1((wins / window.length) * 100) : 0);
  });
  return { labels, values, dates: closed.map((trade) => formatDateDisplay(trade.date) || "") };
}

function renderAnalysisCharts() {
  if (typeof Chart === "undefined") return;
  destroyCharts("analysis-");

  const levelData = levelWinRateChartData();
  if (levelData.length) {
    createChart("analysis-level-wr", {
      type: "bar",
      data: {
        labels: levelData.map((row) => row.key),
        datasets: [{
          label: "Win Rate %",
          data: levelData.map((row) => round1(row.winRate)),
          backgroundColor: levelData.map((row) => winRateBarColor(row.winRate)),
          borderColor: levelData.map((row) => winRateBarColor(row.winRate)),
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: chartTooltipOptions()
        },
        scales: {
          x: {
            min: 0,
            max: 100,
            ticks: { color: "rgba(232,237,245,0.75)", font: { family: "Inter" }, callback: (v) => `${v}%` },
            grid: { color: chartGridColor() },
            border: { display: false }
          },
          y: {
            ticks: { color: "rgba(232,237,245,0.85)", font: { family: "Inter", size: 11 } },
            grid: { display: false },
            border: { display: false }
          }
        }
      }
    });
  }

  const tfData = tfWinRateChartData();
  if (tfData.length) {
    createChart("analysis-tf-wr", {
      type: "bar",
      data: {
        labels: tfData.map((row) => row.key),
        datasets: [{
          label: "Win Rate %",
          data: tfData.map((row) => round1(row.winRate)),
          backgroundColor: tfData.map((row) => winRateBarColor(row.winRate)),
          borderColor: tfData.map((row) => winRateBarColor(row.winRate)),
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: chartTooltipOptions()
        },
        scales: chartScaleOptions(true, true)
      }
    });
  }

  const equity = equityCurveChartData();
  if (equity.values.length > 1) {
    const canvas = document.getElementById("analysis-equity");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, 0, 240);
      gradient.addColorStop(0, "rgba(240,189,85,0.3)");
      gradient.addColorStop(1, "rgba(240,189,85,0)");
      createChart("analysis-equity", {
        type: "line",
        data: {
          labels: equity.labels,
          datasets: [{
            label: "Cumulative P&L",
            data: equity.values,
            borderColor: "#f0bd55",
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: "#f0bd55",
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...chartTooltipOptions(),
              callbacks: {
                title(items) {
                  const idx = items[0]?.dataIndex ?? 0;
                  const tradeNo = equity.labels[idx] || "";
                  const date = equity.dates[idx] || "";
                  return date ? `${tradeNo} · ${date}` : tradeNo;
                },
                label(item) {
                  return `Cumulative P&L: ${signed(item.parsed.y)} $`;
                }
              }
            }
          },
          scales: chartScaleOptions(true, true)
        }
      });
    }
  }

  const sessionData = sessionPnlChartData();
  if (sessionData.length) {
    createChart("analysis-session-pnl", {
      type: "polarArea",
      data: {
        labels: sessionData.map((row) => row.key),
        datasets: [{
          label: "Total P&L",
          data: sessionData.map((row) => Math.abs(row.pnl)),
          backgroundColor: sessionData.map((row) => (row.pnl >= 0 ? "rgba(62,207,142,0.55)" : "rgba(240,82,82,0.55)")),
          borderColor: sessionData.map((row) => (row.pnl >= 0 ? "#3ecf8e" : "#f05252")),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: chartLegendOptions("bottom"),
          tooltip: {
            ...chartTooltipOptions(),
            callbacks: {
              label(context) {
                const row = sessionData[context.dataIndex];
                return `${row.key}: ${signed(row.pnl)} $ (${row.count} trades)`;
              }
            }
          }
        },
        scales: {
          r: {
            ticks: { display: false },
            grid: { color: chartGridColor() },
            angleLines: { color: chartGridColor() }
          }
        }
      }
    });
  }

  const mistakeData = mistakeChartData();
  if (mistakeData.length) {
    const total = mistakeData.reduce((sum, row) => sum + row.count, 0);
    createChart("analysis-mistake", {
      type: "doughnut",
      plugins: [doughnutCenterTextPlugin],
      data: {
        labels: mistakeData.map((row) => row.key),
        datasets: [{
          data: mistakeData.map((row) => row.count),
          backgroundColor: ["#f05252", "#f0bd55", "#ff8f66", "#a78bfa", "#62a8ff", "#3ecf8e", "#fb7185", "#fbbf24"],
          borderColor: "#10141a",
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: chartLegendOptions("bottom"),
          tooltip: {
            ...chartTooltipOptions(),
            callbacks: {
              label(context) {
                const count = context.parsed || 0;
                const pct = total ? ((count / total) * 100).toFixed(1) : 0;
                return `${context.label}: ${count} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  const rolling = rollingWinRateChartData();
  if (rolling.values.length) {
    createChart("analysis-rolling-wr", {
      type: "line",
      data: {
        labels: rolling.labels,
        datasets: [
          {
            label: "Rolling 10-Trade Win Rate",
            data: rolling.values,
            borderColor: "#3ecf8e",
            backgroundColor: "rgba(62,207,142,0.08)",
            fill: false,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 5,
            borderWidth: 2
          },
          {
            label: "50% Reference",
            data: rolling.values.map(() => 50),
            borderColor: "#f05252",
            borderDash: [6, 4],
            pointRadius: 0,
            borderWidth: 1,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: chartLegendOptions("bottom"),
          tooltip: {
            ...chartTooltipOptions(),
            callbacks: {
              title(items) {
                const idx = items[0]?.dataIndex ?? 0;
                const date = rolling.dates[idx] || "";
                return date ? `${rolling.labels[idx]} · ${date}` : rolling.labels[idx];
              }
            }
          }
        },
        scales: {
          ...chartScaleOptions(true, true),
          y: {
            min: 0,
            max: 100,
            ticks: { color: "rgba(232,237,245,0.75)", font: { family: "Inter" }, callback: (v) => `${v}%` },
            grid: { color: chartGridColor() },
            border: { display: false }
          }
        }
      }
    });
  }
}

function renderPnlCharts() {
  if (typeof Chart === "undefined") return;
  destroyCharts("pnl-");
  const monthly = monthlyPnlChartData();
  if (!monthly.length) return;
  createChart("pnl-monthly", {
    type: "bar",
    data: {
      labels: monthly.map((row) => row.label),
      datasets: [{
        label: "Monthly P&L",
        data: monthly.map((row) => row.pnl),
        backgroundColor: monthly.map((row) => (row.pnl >= 0 ? "rgba(62,207,142,0.75)" : "rgba(240,82,82,0.75)")),
        borderColor: monthly.map((row) => (row.pnl >= 0 ? "#3ecf8e" : "#f05252")),
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartTooltipOptions(),
          callbacks: {
            label(context) {
              const row = monthly[context.dataIndex];
              return [`Total: ${signed(row.pnl)} $`, `Trades: ${row.trades}`];
            }
          }
        }
      },
      scales: chartScaleOptions(true, true)
    }
  });
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
        <td class="key-cell" data-label="Name">${escapeHtml(key)}${bestKey === key ? ` <span class="best-badge">â­ Best</span>` : ""}</td>
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
    if (!trade.date) return;
    if (!map.has(trade.date)) {
      map.set(trade.date, {
        date: trade.date,
        pnl: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        bes: 0,
        open: 0,
        indexes: []
      });
    }
    const day = map.get(trade.date);
    day.trades += 1;
    day.indexes.push(index + 1);
    if (!trade.result) {
      day.open += 1;
      return;
    }
    day.pnl = round1(day.pnl + (parseFloat(trade.pnl) || 0));
    day.wins += trade.result === "WIN" ? 1 : 0;
    day.losses += trade.result === "LOSS" ? 1 : 0;
    day.bes += trade.result === "BE" ? 1 : 0;
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
  const mostActive = days.length ? days.slice().sort((a, b) => b.trades - a.trades)[0] : null;
  const winRate = tradingDays ? profitable / tradingDays * 100 : 0;
  const maxAbs = days.length ? Math.max(...days.map((day) => Math.abs(day.pnl)), 1) : 1;
  const closedWins = days.reduce((sum, day) => sum + day.wins, 0);
  const closedLosses = days.reduce((sum, day) => sum + day.losses, 0);
  const closedBes = days.reduce((sum, day) => sum + day.bes, 0);
  return {
    map,
    days,
    tradingDays,
    totalTrades,
    profitable,
    losing,
    totalPnl,
    avgDaily,
    best,
    worst,
    mostActive,
    winRate,
    maxAbs,
    closedWins,
    closedLosses,
    closedBes
  };
}

function monthWeekdayRows(year, month) {
  const cells = monthCells(year, month);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    const weekDays = cells.slice(i + 1, i + 6);
    if (weekDays.some((cell) => cell.inMonth)) rows.push({ weekDays });
  }
  return rows;
}

function weekRangeLabel(weekDays) {
  const start = weekDays[0];
  const end = weekDays[4];
  const startDate = new Date(`${start.iso}T00:00:00`);
  const endDate = new Date(`${end.iso}T00:00:00`);
  const sm = DATE_MONTHS[startDate.getMonth()].slice(0, 3);
  const em = DATE_MONTHS[endDate.getMonth()].slice(0, 3);
  if (sm === em) return `${sm} ${start.day} - ${end.day}`;
  return `${sm} ${start.day} - ${em} ${end.day}`;
}

function weekSummaryStats(weekDays, map) {
  let pnl = 0;
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let bes = 0;
  let open = 0;
  let activeDays = 0;
  weekDays.forEach((cell) => {
    const day = map.get(cell.iso);
    if (!day?.trades) return;
    activeDays += 1;
    pnl = round1(pnl + day.pnl);
    trades += day.trades;
    wins += day.wins;
    losses += day.losses;
    bes += day.bes;
    open += day.open;
  });
  const closed = wins + losses + bes;
  const winRate = closed ? Math.round((wins / closed) * 100) : 0;
  return { pnl, trades, wins, losses, bes, open, activeDays, winRate, closed };
}

function dayStatusLine(day) {
  if (!day?.trades) return "";
  const parts = [];
  if (day.wins) parts.push(`${day.wins} Win`);
  if (day.losses) parts.push(`${day.losses} Loss`);
  if (day.bes) parts.push(`${day.bes} BE`);
  if (day.open) parts.push(`${day.open} Open`);
  return parts.join(" · ");
}

function monthTradeRows(year, month) {
  recalcCum();
  return state.trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => {
      if (!trade.date || !trade.result) return false;
      const d = new Date(`${trade.date}T00:00:00`);
      return d.getFullYear() === year && d.getMonth() === month;
    });
}

function pnlDashboardStats(year, month, stats) {
  const trades = monthTradeRows(year, month);
  const wins = trades.filter(({ trade }) => trade.result === "WIN");
  const losses = trades.filter(({ trade }) => trade.result === "LOSS");
  const bes = trades.filter(({ trade }) => trade.result === "BE");
  const grossWin = round1(wins.reduce((sum, { trade }) => sum + (parseFloat(trade.pnl) || 0), 0));
  const grossLoss = round1(losses.reduce((sum, { trade }) => sum + Math.abs(parseFloat(trade.pnl) || 0), 0));
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin ? grossWin : 0;
  const expectancy = trades.length ? round1(stats.totalPnl / trades.length) : 0;
  const winRateTrades = trades.length ? wins.length / trades.length * 100 : 0;
  const avgWin = wins.length ? round1(grossWin / wins.length) : 0;
  const avgLoss = losses.length ? round1(grossLoss / losses.length) : 0;
  const payoff = avgLoss ? avgWin / avgLoss : avgWin ? avgWin : 0;
  const equity = [];
  let cum = 0;
  trades
    .slice()
    .sort((a, b) => String(a.trade.date).localeCompare(String(b.trade.date)) || a.index - b.index)
    .forEach(({ trade }) => {
      cum = round1(cum + (parseFloat(trade.pnl) || 0));
      equity.push({ date: trade.date, value: cum });
    });
  const drawdowns = [];
  let peak = 0;
  equity.forEach((point) => {
    peak = Math.max(peak, point.value);
    drawdowns.push({ date: point.date, value: round1(point.value - peak) });
  });
  const maxDrawdown = drawdowns.length ? Math.min(...drawdowns.map((point) => point.value), 0) : 0;
  const streak = bestPnlStreak(stats.days);
  const consistency = pnlConsistencyScore(stats, maxDrawdown);
  return { trades, wins, losses, bes, grossWin, grossLoss, profitFactor, expectancy, winRateTrades, avgWin, avgLoss, payoff, equity, drawdowns, maxDrawdown, streak, consistency };
}

function bestPnlStreak(days = []) {
  const ordered = days.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let currentType = "";
  let currentCount = 0;
  const best = { win: 0, loss: 0 };
  ordered.forEach((day) => {
    const type = day.pnl > 0 ? "win" : day.pnl < 0 ? "loss" : "flat";
    if (type === "flat") {
      currentType = "";
      currentCount = 0;
      return;
    }
    currentCount = type === currentType ? currentCount + 1 : 1;
    currentType = type;
    best[type] = Math.max(best[type], currentCount);
  });
  return best;
}

function pnlConsistencyScore(stats, maxDrawdown) {
  if (!stats.tradingDays) return 0;
  const winComponent = Math.min(stats.winRate, 100) * 0.42;
  const activityComponent = Math.min(stats.tradingDays / 12, 1) * 18;
  const drawdownDrag = Math.min(Math.abs(maxDrawdown) / Math.max(Math.abs(stats.totalPnl) + stats.maxAbs, 1), 1) * 24;
  const lossDayDrag = Math.min(stats.losing / Math.max(stats.tradingDays, 1), 1) * 16;
  return Math.max(0, Math.min(100, Math.round(winComponent + activityComponent + 40 - drawdownDrag - lossDayDrag)));
}

function pnlSparkline(points, type = "equity") {
  const values = points.map((point) => point.value);
  if (!values.length) return `<div class="pnl-empty-chart">No closed trades</div>`;
  const width = 520;
  const height = 150;
  const pad = 14;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(max - min, 1);
  const poly = values.map((value, index) => {
    const x = pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const zeroY = height - pad - ((0 - min) / span) * (height - pad * 2);
  const stroke = type === "drawdown" ? "#ff6464" : "#43c783";
  const fill = type === "drawdown" ? "pnlDrawdownFill" : "pnlEquityFill";
  return `
    <svg class="pnl-sparkline ${type}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(type)} chart">
      <defs>
        <linearGradient id="${fill}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${stroke}" stop-opacity="0.26" />
          <stop offset="100%" stop-color="${stroke}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${width - pad}" y2="${zeroY.toFixed(1)}" />
      <polyline points="${pad},${height - pad} ${poly} ${width - pad},${height - pad}" fill="url(#${fill})" />
      <polyline points="${poly}" />
    </svg>
  `;
}

function pnlGroupRows(trades, field, fallback = "-") {
  const map = new Map();
  trades.forEach(({ trade }) => {
    const key = trade[field] || fallback;
    if (!map.has(key)) map.set(key, { key, trades: 0, pnl: 0, wins: 0, losses: 0 });
    const row = map.get(key);
    row.trades += 1;
    row.pnl = round1(row.pnl + (parseFloat(trade.pnl) || 0));
    row.wins += trade.result === "WIN" ? 1 : 0;
    row.losses += trade.result === "LOSS" ? 1 : 0;
  });
  return Array.from(map.values()).sort((a, b) => b.pnl - a.pnl || b.trades - a.trades);
}

function pnlWeekdayRows(days) {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const rows = labels.map((label) => ({ key: label, trades: 0, pnl: 0, wins: 0, losses: 0 }));
  days.forEach((day) => {
    const index = new Date(`${day.date}T00:00:00`).getDay();
    rows[index].trades += day.trades;
    rows[index].pnl = round1(rows[index].pnl + day.pnl);
    rows[index].wins += day.pnl > 0 ? 1 : 0;
    rows[index].losses += day.pnl < 0 ? 1 : 0;
  });
  return rows;
}

function pnlBars(title, rows, icon) {
  const active = rows.filter((row) => row.trades || row.pnl);
  const maxAbs = Math.max(...active.map((row) => Math.abs(row.pnl)), 1);
  const body = active.length ? active.map((row) => {
    const width = Math.max(6, Math.round(Math.abs(row.pnl) / maxAbs * 100));
    const wr = row.trades ? row.wins / row.trades * 100 : 0;
    return `
      <div class="pnl-bar-row">
        <div><b>${escapeHtml(row.key)}</b><span>${row.trades} trades · ${wr.toFixed(0)}% WR</span></div>
        <div class="pnl-bar-track"><i class="${moneyClass(row.pnl)}" style="width:${width}%"></i></div>
        <strong class="${moneyClass(row.pnl)}">${signed(row.pnl)} $</strong>
      </div>
    `;
  }).join("") : `<div class="pnl-empty-mini">No data</div>`;
  return `
    <section class="pnl-analytics-card">
      <h3><i data-lucide="${icon}"></i><span>${escapeHtml(title)}</span></h3>
      <div class="pnl-bars">${body}</div>
    </section>
  `;
}

function pnlDistribution(days, maxAbs) {
  const body = days.length ? days
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((day) => {
      const height = Math.max(10, Math.round(Math.abs(day.pnl) / Math.max(maxAbs, 1) * 92));
      return `<button class="pnl-dist-bar ${moneyClass(day.pnl)}" style="height:${height}px" onclick="selectPnlDay('${day.date}')" title="${escapeHtml(formatDateDisplay(day.date))}: ${signed(day.pnl)} $"><span>${new Date(`${day.date}T00:00:00`).getDate()}</span></button>`;
    }).join("") : `<div class="pnl-empty-mini">No trading days</div>`;
  return `
    <section class="pnl-analytics-card">
      <h3><i data-lucide="bar-chart-3"></i><span>Daily Distribution</span></h3>
      <div class="pnl-distribution">${body}</div>
    </section>
  `;
}

function pnlSelectedTrades(selected) {
  if (!selected) return `<div class="pnl-trade-list empty">No trades on selected day</div>`;
  const rows = selected.indexes.map((tradeNo) => {
    const trade = state.trades[tradeNo - 1];
    if (!trade) return "";
    return `
      <button class="pnl-trade-row" onclick="openViewTradeModal(${tradeNo - 1})">
        <span>#${tradeNo}</span>
        <b>${escapeHtml(trade.entry || "-")} · ${escapeHtml(trade.level || "-")}</b>
        <em class="${moneyClass(trade.pnl)}">${signed(trade.pnl)} $</em>
      </button>
    `;
  }).join("");
  return `<div class="pnl-trade-list">${rows}</div>`;
}

function renderPnl() {
  destroyCharts("pnl-");
  const el = document.getElementById("pnl-content");
  if (!el) return;
  const { year, month } = pnlView;
  const stats = monthPnlStats(year, month);
  const dashboard = pnlDashboardStats(year, month, stats);
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  if (pnlView.selectedDate && !pnlView.selectedDate.startsWith(monthPrefix)) {
    pnlView.selectedDate = null;
  }
  const weekRows = monthWeekdayRows(year, month);
  const selected = pnlView.selectedDate ? stats.map.get(pnlView.selectedDate) : null;
  const selectedLabel = pnlView.selectedDate ? `${dayName(pnlView.selectedDate)}, ${formatDateDisplay(pnlView.selectedDate)}` : "";
  const sessionRows = pnlGroupRows(dashboard.trades, "session");
  const setupRows = pnlGroupRows(dashboard.trades, "setup");
  const weekdayRows = pnlWeekdayRows(stats.days);
  const monthTone = moneyClass(stats.totalPnl);

  el.innerHTML = `
    <div class="pnl-dashboard">
      <section class="pnl-cal-board">
        <div class="pnl-cal-toolbar">
          <button class="icon-btn" onclick="changePnlMonth(-1)" title="Previous month" aria-label="Previous month"><i data-lucide="chevron-left"></i></button>
          <div class="pnl-cal-toolbar-title">
            <h2>${escapeHtml(monthTitle(year, month))}</h2>
            <p>Daily P&amp;L calendar</p>
          </div>
          <button class="icon-btn" onclick="changePnlMonth(1)" title="Next month" aria-label="Next month"><i data-lucide="chevron-right"></i></button>
          <button class="soft-btn pnl-cal-today" onclick="goCurrentPnlMonth()">Today</button>
        </div>

        <div class="pnl-cal-stats">
          ${pnlCalendarStat("Monthly P&amp;L", `<span class="${monthTone}">${signed(stats.totalPnl)} $</span>`, "", monthTone)}
          ${pnlCalendarStat("Trading Days", `${stats.tradingDays}d`, `${stats.profitable} green · ${stats.losing} red`)}
          ${pnlCalendarStat("Trades", `${stats.totalTrades} total`, `${stats.closedWins}W · ${stats.closedLosses}L${stats.closedBes ? ` · ${stats.closedBes}BE` : ""}`)}
          ${pnlCalendarStat("Best Day", stats.best ? `<span class="pos">${signed(stats.best.pnl)} $</span>` : "-", stats.best ? formatDateDisplay(stats.best.date) : "No data")}
          ${pnlCalendarStat("Worst Day", stats.worst ? `<span class="neg">${signed(stats.worst.pnl)} $</span>` : "-", stats.worst ? formatDateDisplay(stats.worst.date) : "No data")}
          ${pnlCalendarStat("Most Active Day", stats.mostActive ? `${stats.mostActive.trades} trades` : "-", stats.mostActive ? formatDateDisplay(stats.mostActive.date) : "No data")}
          ${pnlCalendarStat("Avg / Day", `<span class="${monthTone}">${signed(stats.avgDaily)} $</span>`)}
          ${pnlCalendarStat("Win Rate", `<span class="${stats.winRate >= 50 ? "pos" : "neg"}">${stats.winRate.toFixed(0)}%</span>`, "profitable days")}
        </div>

        <div class="pnl-cal-grid">
          ${["Mon", "Tue", "Wed", "Thu", "Fri", "Week"].map((label) => `<div class="pnl-cal-head">${label}</div>`).join("")}
          ${weekRows.map((row) => `
            ${row.weekDays.map((cell) => pnlDayCell(cell, stats)).join("")}
            ${pnlWeekCell(row.weekDays, stats)}
          `).join("")}
        </div>

        ${pnlView.selectedDate ? `
          <div class="pnl-cal-selected">
            <div class="pnl-cal-selected-head">
              <div>
                <span>Selected Day</span>
                <b>${escapeHtml(selectedLabel)}</b>
              </div>
              <div class="pnl-cal-selected-meta">
                <strong class="${moneyClass(selected?.pnl || 0)}">${selected ? signed(selected.pnl) : "$0.00"} $</strong>
                <small>${selected ? `${selected.trades} trade${selected.trades === 1 ? "" : "s"} · ${escapeHtml(dayStatusLine(selected))}` : "No trades"}</small>
              </div>
              <button class="icon-btn" onclick="clearPnlSelection()" title="Clear selection" aria-label="Clear selection"><i data-lucide="x"></i></button>
            </div>
            ${pnlSelectedTrades(selected)}
          </div>
        ` : ""}
      </section>

      <section class="pnl-kpi-grid">
        ${pnlKpi("Win Rate", `${dashboard.winRateTrades.toFixed(1)}%`, `${dashboard.wins.length}W / ${dashboard.losses.length}L / ${dashboard.bes.length}BE`, "target")}
        ${pnlKpi("Profit Factor", dashboard.profitFactor.toFixed(2), `${signed(dashboard.grossWin)} $ gross win`, "activity")}
        ${pnlKpi("Expectancy", `${signed(dashboard.expectancy)} $`, "per closed trade", "calculator")}
        ${pnlKpi("Max Drawdown", `${signed(dashboard.maxDrawdown)} $`, `${dashboard.streak.loss} day losing streak`, "shield-alert", moneyClass(dashboard.maxDrawdown))}
        ${pnlKpi("Avg Win", `${signed(dashboard.avgWin)} $`, `Payoff ${dashboard.payoff.toFixed(2)}R`, "trending-up", "pos")}
        ${pnlKpi("Avg Loss", `${signed(-dashboard.avgLoss)} $`, `${dashboard.streak.win} day winning streak`, "trending-down", "neg")}
      </section>

      <section class="pnl-chart-grid">
        <article class="pnl-chart-card">
          <div class="pnl-card-title"><span>Equity Curve</span><b class="${moneyClass(stats.totalPnl)}">${signed(stats.totalPnl)} $</b></div>
          ${pnlSparkline(dashboard.equity, "equity")}
        </article>
        <article class="pnl-chart-card">
          <div class="pnl-card-title"><span>Drawdown Curve</span><b class="neg">${signed(dashboard.maxDrawdown)} $</b></div>
          ${pnlSparkline(dashboard.drawdowns, "drawdown")}
        </article>
      </section>

      <section class="pnl-analytics-grid">
        ${pnlBars("Session Edge", sessionRows, "clock-3")}
        ${pnlBars("Setup Quality", setupRows, "layers-3")}
        ${pnlBars("Weekday P&L", weekdayRows, "calendar-days")}
        ${pnlDistribution(stats.days, stats.maxAbs)}
      </section>

      <section class="chart-card" style="margin-top:16px">
        <h4>Monthly P&amp;L</h4>
        <canvas id="pnl-monthly" aria-label="Monthly P and L chart"></canvas>
      </section>
    </div>
  `;
  renderPnlCharts();
  refreshIcons();
}

function pnlKpi(label, value, detail, icon, tone = "") {
  return `
    <article class="pnl-kpi ${tone}">
      <i data-lucide="${icon}"></i>
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function legendItem(cls, label) {
  return `<span><i class="${cls}"></i>${escapeHtml(label)}</span>`;
}

function pnlStat(label, value) {
  return `<div class="pnl-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function pnlCalendarStat(label, value, detail = "", tone = "") {
  return `
    <div class="pnl-cal-stat ${tone}">
      <span>${escapeHtml(label)}</span>
      <b>${value}</b>
      ${detail ? `<small>${detail}</small>` : ""}
    </div>
  `;
}

function pnlDayCell(cell, stats) {
  const day = stats.map.get(cell.iso);
  const hasTrades = Boolean(day?.trades);
  const pnl = day?.pnl || 0;
  let tone = "empty";
  if (hasTrades) {
    if (pnl > 0) tone = "profit";
    else if (pnl < 0) tone = "loss";
    else tone = "flat";
  }
  const selected = cell.iso === pnlView.selectedDate ? "selected" : "";
  const muted = cell.inMonth ? "" : "muted";
  const pnlText = hasTrades ? `${signed(pnl)} $` : (cell.inMonth ? "$0.00" : "");
  return `
    <button type="button" class="pnl-cal-day ${tone} ${selected} ${muted}" onclick="selectPnlDay('${cell.iso}')" ${cell.inMonth ? "" : "tabindex=\"-1\""}>
      <span class="pnl-cal-date">${cell.day}</span>
      <strong class="pnl-cal-pnl">${pnlText}</strong>
      <small class="pnl-cal-trades">${hasTrades ? `${day.trades} trade${day.trades === 1 ? "" : "s"}` : ""}</small>
      <em class="pnl-cal-status">${escapeHtml(dayStatusLine(day))}</em>
    </button>
  `;
}

function pnlWeekCell(weekDays, stats) {
  const summary = weekSummaryStats(weekDays, stats.map);
  if (!summary.trades) {
    return `
      <div class="pnl-cal-week empty">
        <span class="pnl-cal-week-range">${escapeHtml(weekRangeLabel(weekDays))}</span>
        <strong>No trades</strong>
      </div>
    `;
  }
  const tone = summary.pnl > 0 ? "profit" : summary.pnl < 0 ? "loss" : "flat";
  return `
    <div class="pnl-cal-week ${tone}">
      <span class="pnl-cal-week-range">${escapeHtml(weekRangeLabel(weekDays))}</span>
      <strong class="pnl-cal-week-pnl">${signed(summary.pnl)} $</strong>
      <small>${summary.activeDays} day${summary.activeDays === 1 ? "" : "s"} · ${summary.trades} trade${summary.trades === 1 ? "" : "s"}</small>
      <em>${summary.wins} Win · ${summary.losses} Loss${summary.bes ? ` · ${summary.bes} BE` : ""} · ${summary.winRate}%</em>
    </div>
  `;
}

function selectPnlDay(iso) {
  pnlView.selectedDate = iso;
  renderPnl();
}

function clearPnlSelection() {
  pnlView.selectedDate = null;
  renderPnl();
}

function changePnlMonth(delta) {
  const d = new Date(pnlView.year, pnlView.month + delta, 1);
  pnlView.year = d.getFullYear();
  pnlView.month = d.getMonth();
  pnlView.selectedDate = null;
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
  const cumVals = chronologicalRows.filter((row) => row.cum !== "").map((row) => parseFloat(row.cum));
  const maxDrawdown = calcMaxDrawdown(cumVals);
  return {
    closed,
    wins,
    losses,
    bes,
    totalPnl,
    winRate,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? grossWin : 0,
    expectancy: closed.length ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss : 0,
    maxDrawdown,
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

function reportScreenshotsSection(items) {
  const rows = items.filter(({ trade }) => safeHttpUrl(trade.screenshotUrl));
  if (!rows.length) return "";
  return `
    <section class="r-section r-screenshots-section">
      <h2>Trade Screenshots</h2>
      ${rows.map(({ trade, index }) => {
        const pnl = calcPnl(trade.risk, trade.reward, trade.result);
        const pnlText = pnl === "" ? "-" : `${signed(pnl)} pips`;
        const screenshotUrl = safeHttpUrl(trade.screenshotUrl);
        return `
          <article class="r-screenshot-card">
            <header>
              <div>
                <b>Trade #${index + 1}</b>
                <span>${escapeHtml(formatDateDisplay(trade.date) || "-")} | ${escapeHtml(trade.level || "-")} | ${escapeHtml(trade.tf || "-")}</span>
              </div>
              ${reportBadge(trade.result, "result")}
            </header>
            <img src="${escapeHtml(screenshotUrl)}" alt="Trade #${index + 1} screenshot" referrerpolicy="no-referrer">
            <p class="r-screenshot-summary">Risk: ${escapeHtml(trade.risk || "-")}pips | Reward: ${escapeHtml(trade.reward || "-")}pips | TP: ${escapeHtml(trade.tpPlacement || "-")} | RR: ${escapeHtml(calcRR(trade.risk, trade.reward) || "-")} | P&amp;L: ${escapeHtml(pnlText)}</p>
            ${trade.reason ? `<p class="r-screenshot-notes">${escapeHtml(trade.reason)}</p>` : ""}
          </article>
        `;
      }).join("")}
    </section>
  `;
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
        <thead><tr><th>Name</th><th>Trades</th><th>Wins</th><th>Win%</th><th>Total P&amp;L</th></tr></thead>
        <tbody>
          ${rows.map((row) => {
            const wr = row.trades ? row.wins / row.trades * 100 : 0;
            return `<tr><td>${escapeHtml(row.key)}</td><td>${row.trades}</td><td class="r-pos">${row.wins}</td><td>${wr.toFixed(0)}%</td><td class="${row.pnl >= 0 ? "r-pos" : "r-neg"}">${signed(row.pnl)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function patienceStars(score) {
  const n = Math.max(0, Math.min(5, parseInt(score, 10) || 0));
  return `${"â˜…".repeat(n)}${"â˜†".repeat(5 - n)}`;
}

function reportTradeBorderClass(result) {
  if (result === "WIN") return "r-border-win";
  if (result === "LOSS") return "r-border-loss";
  if (result === "BE") return "r-border-be";
  return "r-border-open";
}

function reportTradeCard({ trade, index, pnl, cum }) {
  const border = reportTradeBorderClass(trade.result);
  const screenshotUrl = safeHttpUrl(trade.screenshotUrl);
  const imageBlock = screenshotUrl
    ? `<img class="r-card-image" src="${escapeHtml(screenshotUrl)}" alt="Trade #${index + 1} screenshot" referrerpolicy="no-referrer">`
    : `<div class="r-card-placeholder">No screenshot</div>`;
  const pnlText = pnl === "" ? "-" : `${signed(pnl)} pips`;
  const cumText = cum === "" ? "-" : `${signed(cum)} pips`;
  return `
    <article class="r-trade-card ${border}">
      <div class="r-card-head">
        <strong>Trade #${index + 1}</strong>
        <span>${escapeHtml(formatDateDisplay(trade.date) || "-")}</span>
        ${reportBadge(trade.result, "result")}
      </div>
      <div class="r-card-image-wrap">${imageBlock}</div>
      <div class="r-card-body">
        <div class="r-card-row"><b>Level:</b> ${escapeHtml(trade.level || "-")} <b>TF:</b> ${escapeHtml(trade.tf || "-")} <b>Session:</b> ${escapeHtml(trade.session || "-")}</div>
        <div class="r-card-row"><b>Side:</b> ${escapeHtml(trade.entry || "-")} <b>RR:</b> ${escapeHtml(calcRR(trade.risk, trade.reward) || "-")} <b>Risk:</b> ${escapeHtml(trade.risk || "-")} <b>Reward:</b> ${escapeHtml(trade.reward || "-")}</div>
        <div class="r-card-row"><b>P&amp;L:</b> ${escapeHtml(pnlText)} <b>Cumul:</b> ${escapeHtml(cumText)}</div>
      </div>
      <div class="r-card-meta">
        <div class="r-card-row"><b>Setup:</b> ${escapeHtml(trade.setup || "-")} <b>Market:</b> ${escapeHtml(trade.marketCondition || "-")} <b>Confirm:</b> ${escapeHtml(trade.confirmationType || "-")}</div>
        <div class="r-card-row"><b>Bias:</b> ${escapeHtml(trade.biasAlignment || "-")} <b>Mistake:</b> ${escapeHtml(trade.mistake || "-")}</div>
        <div class="r-card-row"><b>Hold:</b> ${escapeHtml(trade.hold || "-")} <b>Patience:</b> ${trade.patienceScore ? patienceStars(trade.patienceScore) : "-"}</div>
      </div>
      <div class="r-card-notes"><b>Notes:</b> ${escapeHtml(trade.reason || "-")}</div>
    </article>
  `;
}

function reportTradeCardPages(rows) {
  if (!rows.length) {
    return `<div class="r-page"><div class="r-card-grid"><p>No trades found for this range.</p></div></div>`;
  }
  const pages = [];
  for (let i = 0; i < rows.length; i += 2) {
    const pair = rows.slice(i, i + 2);
    pages.push(`
      <div class="r-page">
        <div class="r-card-grid">
          ${pair.map((row) => reportTradeCard(row)).join("")}
        </div>
      </div>
      <div class="r-page-break"></div>
    `);
  }
  return pages.join("");
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

  return `
    <div class="r-page r-cover-page">
      <h1 class="r-cover-title">XAUUSD Trading Journal</h1>
      <p class="r-cover-subtitle">Performance Report</p>
      <p class="r-cover-range">${escapeHtml(rangeLabel(range))}</p>
      <p class="r-cover-generated">Generated ${escapeHtml(generated)}</p>
      <div class="r-cover-kpis">
        <div class="r-cover-kpi"><span>Closed Trades</span><b>${p.closed.length}</b></div>
        <div class="r-cover-kpi"><span>Win Rate</span><b class="${p.winRate >= 50 ? "r-pos" : "r-neg"}">${p.winRate.toFixed(1)}%</b></div>
        <div class="r-cover-kpi"><span>Total P&amp;L</span><b class="${p.totalPnl >= 0 ? "r-pos" : "r-neg"}">${signed(p.totalPnl)} $</b></div>
        <div class="r-cover-kpi"><span>Profit Factor</span><b>${p.profitFactor.toFixed(2)}</b></div>
        <div class="r-cover-kpi"><span>Expectancy</span><b class="${p.expectancy >= 0 ? "r-pos" : "r-neg"}">${signed(p.expectancy)} $</b></div>
        <div class="r-cover-kpi"><span>Max Drawdown</span><b class="r-neg">${signed(p.maxDrawdown)} $</b></div>
      </div>
    </div>
    <div class="r-page-break"></div>
    ${reportTradeCardPages(p.rows)}
    <div class="r-page">
      <header class="r-header">
        <div>
          <div class="r-kicker">Analysis Summary</div>
          <h1>Performance Breakdown</h1>
          <p>${escapeHtml(rangeLabel(range))}</p>
        </div>
      </header>
      <div class="r-analysis-grid">
        ${reportAnalysisTable("Session Analysis", items, "session")}
        ${reportAnalysisTable("Level Analysis", items, "level")}
        ${reportAnalysisTable("Setup Analysis", items, "setup")}
        ${reportAnalysisTable("Mistake Analysis", items, "mistake")}
        ${reportAnalysisTable("Market Condition Analysis", items, "marketCondition")}
        ${reportAnalysisTable("Confirmation Type Analysis", items, "confirmationType")}
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
  const learned = document.getElementById("review-learned")?.value.trim() || "";
  const pattern = document.getElementById("review-pattern")?.value.trim() || "";
  const improve = document.getElementById("review-improve")?.value.trim() || "";

  if (!learned && !pattern && !improve) {
    toast("Please fill in at least one detail to save.");
    return;
  }

  const review = normalizeWeeklyReview({
    weekOf: document.getElementById("review-week")?.value || todayISO(),
    learned,
    pattern,
    improve,
    createdAt: new Date().toISOString()
  });
  state.weeklyReviews.push(review);
  save();
  ["review-learned", "review-pattern", "review-improve"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const weekEl = document.getElementById("review-week");
  if (weekEl) weekEl.value = todayISO();
  renderWeeklyReviews();
  toast("Weekly review saved.");
}

function deleteWeeklyReview(id) {
  if (!confirm("Delete this weekly review? This cannot be undone.")) return;
  state.weeklyReviews = state.weeklyReviews.filter((review) => review.id !== id);
  save();
  renderWeeklyReviews();
  if (id && currentUser) deleteReviewFromSupabase(id);
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
  const accountName = activeAccount().name;
  if (!confirm(`Clear ALL trades for "${accountName}"? This permanently deletes them from Supabase too. This cannot be undone.`)) return;
  // Double-check account is still the same
  if (activeAccountId !== activeAccount().id) {
    toast("Account changed. Please try again.");
    return;
  }
  state.trades = [];
  syncMemoryState();
  renderTrades();
  if (document.getElementById("tab-analysis")?.classList.contains("active")) renderAnalysis();
  if (document.getElementById("tab-pnl")?.classList.contains("active")) renderPnl();

  if (currentUser && supabaseReady) {
    try {
      updateSyncStatus("syncing");
      await supabaseClient.from("trades")
        .delete()
        .eq("user_id", currentUser.id)
        .eq("account_id", activeAccountId);
      updateSyncStatus("synced");
      toast("Trades cleared from Supabase.");
      return;
    } catch (error) {
      console.warn("Could not clear Supabase trades", error);
      updateSyncStatus("offline");
      toast("Could not clear trades from Supabase.");
      return;
    }
  }

  toast("Sign in to clear trades.");
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

function authRedirectUrl() {
  return `${window.location.origin}/auth/callback`;
}

function cleanAuthQueryFromUrl() {
  const url = new URL(window.location.href);
  ["code", "state", "error", "error_description"].forEach((param) => url.searchParams.delete(param));
  const search = url.searchParams.toString();
  const next = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
  window.history.replaceState({}, document.title, next || "/");
}

async function completeOAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const authError = params.get("error_description") || params.get("error");
  if (authError) {
    cleanAuthQueryFromUrl();
    setAuthStatus(decodeURIComponent(authError.replace(/\+/g, " ")), "error");
    return false;
  }
  if (!code) return false;
  if (!supabaseClient && !initSupabase()) return false;

  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-") || key === "supabase.auth.token") {
        localStorage.removeItem(key);
      }
    });
  } catch (storageError) {
    console.warn("Could not clear stale Supabase auth storage before OAuth exchange", storageError);
  }

  cleanAuthQueryFromUrl();
  try {
    const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
    if (error) {
      const message = supabaseAuthMessage(error);
      setAuthStatus(message, "error");
      showLoginScreen();
      return false;
    }
    return true;
  } catch (error) {
    console.error("OAuth callback failed", error);
    setAuthStatus("Google sign-in failed. Please try signing in again.", "error");
    showLoginScreen();
    return false;
  }
}

async function migrateOldCaches() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const key = "gj_cache_migrated_v27";
    if (localStorage.getItem(key)) return; // Already migrated, don't run again

    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    localStorage.setItem(key, "true");
    console.log("One-time Service Worker cache migration completed.");
  } catch (error) {
    console.warn("Could not migrate legacy service worker caches", error);
  }
}

function setAuthStatus(message = "", type = "") {
  const status = document.getElementById("auth-status");
  if (!status) return;
  status.textContent = message;
  if (type) {
    status.dataset.type = type;
  } else {
    delete status.dataset.type;
  }
}

function setGoogleProviderState(enabled, message = "") {
  const button = document.getElementById("google-login-btn");
  const note = document.getElementById("google-provider-note");
  if (button) {
    button.dataset.unavailable = enabled ? "false" : "true";
    button.title = enabled ? "" : message;
  }
  if (note) note.textContent = enabled ? "" : message;
}

function setAuthBusy(nextBusy) {
  authBusy = nextBusy;
  ["google-login-btn", "auth-submit-btn", "auth-mode-signin", "auth-mode-signup"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = nextBusy;
  });
}

function setAuthMode(mode = "signin") {
  authMode = mode === "signup" ? "signup" : "signin";
  const isSignup = authMode === "signup";
  const title = document.getElementById("auth-title");
  const submit = document.getElementById("auth-submit-btn");
  const password = document.getElementById("login-password");
  const signInTab = document.getElementById("auth-mode-signin");
  const signUpTab = document.getElementById("auth-mode-signup");

  if (title) title.textContent = isSignup ? "Create account" : "Sign in";
  if (submit) submit.textContent = isSignup ? "Create account" : "Sign in with Email";
  if (password) {
    password.autocomplete = isSignup ? "new-password" : "current-password";
    password.placeholder = isSignup ? "Minimum 8 characters recommended" : "Minimum 6 characters";
  }
  if (signInTab) {
    signInTab.classList.toggle("active", !isSignup);
    signInTab.setAttribute("aria-selected", String(!isSignup));
  }
  if (signUpTab) {
    signUpTab.classList.toggle("active", isSignup);
    signUpTab.setAttribute("aria-selected", String(isSignup));
  }
  setAuthStatus("");
  refreshIcons();
}

function toggleAuthPassword() {
  const input = document.getElementById("login-password");
  const button = document.getElementById("password-toggle");
  if (!input || !button) return;
  authPasswordVisible = !authPasswordVisible;
  input.type = authPasswordVisible ? "text" : "password";
  button.setAttribute("aria-label", authPasswordVisible ? "Hide password" : "Show password");
  button.innerHTML = authPasswordVisible ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
  refreshIcons();
}

function authFormValues() {
  return {
    email: document.getElementById("login-email")?.value.trim() || "",
    password: document.getElementById("login-password")?.value || ""
  };
}

function validateAuthForm(email, password) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return "Enter your email address.";
  if (/\s/.test(cleanEmail)) return "Email cannot contain spaces.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return "Enter a valid email address.";
  if (!password) return "Enter your password.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  
  if (authMode === "signup") {
    if (password.startsWith(" ") || password.endsWith(" ")) {
      return "Password cannot start or end with spaces.";
    }
    if (password.length < 8) {
      return "Password should be at least 8 characters for better security.";
    }
  }
  return "";
}

function submitAuthForm(event) {
  event?.preventDefault();
  if (authMode === "signup") {
    signUpWithEmail(event);
  } else {
    signInWithEmail(event);
  }
}

function wireAuthUi() {
  document.getElementById("auth-mode-signin")?.addEventListener("click", () => setAuthMode("signin"));
  document.getElementById("auth-mode-signup")?.addEventListener("click", () => setAuthMode("signup"));
  document.getElementById("google-login-btn")?.addEventListener("click", () => signInWithGoogle());
  document.getElementById("password-toggle")?.addEventListener("click", () => toggleAuthPassword());
  document.getElementById("auth-form")?.addEventListener("submit", (event) => submitAuthForm(event));
}

function exposeAuthApi() {
  window.setAuthMode = setAuthMode;
  window.toggleAuthPassword = toggleAuthPassword;
  window.submitAuthForm = submitAuthForm;
  window.signInWithGoogle = signInWithGoogle;
  window.signInWithEmail = signInWithEmail;
  window.signUpWithEmail = signUpWithEmail;
  window.signOutUser = signOutUser;
  window.toggleDiagnosticsPanel = toggleDiagnosticsPanel;
}

async function syncAuthProviderAvailability() {
  if (!supabaseConfig?.url || !supabaseConfig?.anonKey) return;
  try {
    const response = await fetch(`${supabaseConfig.url}/auth/v1/settings`, {
      headers: { apikey: supabaseConfig.anonKey }
    });
    if (!response.ok) return;
    const settings = await response.json();
    authProviders = {
      email: settings?.external?.email !== false,
      google: settings?.external?.google === true
    };
    if (!authProviders.google) {
      setGoogleProviderState(false, "Google sign-in needs Google Client ID and Secret in Supabase.");
    } else {
      setGoogleProviderState(true);
    }
  } catch (error) {
    console.warn("Could not load auth provider settings", error);
  }
}

async function signInWithGoogle() {
  if (!supabaseClient) { toast("Supabase not ready."); return; }
  if (authBusy) return;
  if (!authProviders.google) {
    const message = "Google sign-in needs Google Client ID and Secret in Supabase.";
    setAuthStatus(message, "error");
    toast(message);
    return;
  }
  setAuthBusy(true);
  setAuthStatus("Opening Google sign-in...");
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl(),
        queryParams: { prompt: "select_account" }
      }
    });
    if (error) {
      console.warn("Google sign-in failed", error);
      const message = supabaseAuthMessage(error);
      setAuthStatus(message, "error");
      toast(message);
      setAuthBusy(false);
    }
  } catch (err) {
    console.error("Google sign-in exception", err);
    setAuthStatus("Connection failed.", "error");
    toast("Connection failed.");
    setAuthBusy(false);
  }
}

async function signInWithEmail(event) {
  event?.preventDefault();
  if (!supabaseClient) { toast("Supabase not ready."); return; }
  if (authBusy) return;
  if (!authProviders.email) {
    const message = "Email sign-in is not enabled in Supabase.";
    setAuthStatus(message, "error");
    toast(message);
    return;
  }
  
  const rawForm = authFormValues();
  const email = String(rawForm.email || "").trim().toLowerCase();
  const password = rawForm.password;
  
  const validationError = validateAuthForm(email, password);
  if (validationError) {
    setAuthStatus(validationError, "error");
    toast(validationError);
    return;
  }
  
  setAuthBusy(true);
  setAuthStatus("Signing in...");
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      const message = supabaseAuthMessage(error);
      setAuthStatus(message, "error");
      toast(message);
    } else {
      setAuthStatus("Signed in. Loading journal...", "success");
    }
  } catch (err) {
    console.error("Sign in exception", err);
    setAuthStatus("Connection failed.", "error");
    toast("Connection failed.");
  } finally {
    setAuthBusy(false);
  }
}

async function signUpWithEmail(event) {
  event?.preventDefault();
  if (!supabaseClient) { toast("Supabase not ready."); return; }
  if (authBusy) return;
  if (!authProviders.email) {
    const message = "Email signup is not enabled in Supabase.";
    setAuthStatus(message, "error");
    toast(message);
    return;
  }
  
  const rawForm = authFormValues();
  const email = String(rawForm.email || "").trim().toLowerCase();
  const password = rawForm.password;
  
  const validationError = validateAuthForm(email, password);
  if (validationError) {
    setAuthStatus(validationError, "error");
    toast(validationError);
    return;
  }
  
  setAuthBusy(true);
  setAuthStatus("Creating account...");
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: authRedirectUrl()
      }
    });
    if (error) {
      const message = supabaseAuthMessage(error);
      setAuthStatus(message, "error");
      toast(message);
    } else if (data?.session) {
      const message = "Account created. Loading journal...";
      setAuthStatus(message, "success");
      toast(message);
    } else {
      const message = "Account created. Check your email to confirm it.";
      setAuthStatus(message, "success");
      toast(message);
    }
  } catch (err) {
    console.error("Sign up exception", err);
    setAuthStatus("Connection failed.", "error");
    toast("Connection failed.");
  } finally {
    setAuthBusy(false);
  }
}

async function signOutUser() {
  if (!supabaseClient) return;
  authLoadToken += 1;
  try {
    await supabaseClient.auth.signOut();
  } catch (error) {
    console.warn("Error during Supabase signout", error);
  }
  clearSessionAuthStorage();
  mentorSessionKey = "";
  currentUser = null;
  resetJournalState();
  renderCurrentAccount();
  showLoginScreen();
  updateSyncStatus("offline");
}

function updateUserRow(user) {
  const row = document.getElementById("user-row");
  const avatar = document.getElementById("user-avatar");
  const name = document.getElementById("user-name");
  updateProfileCard(user);
  if (!row || !avatar || !name) return;
  if (!user) {
    row.hidden = true;
    avatar.src = "";
    name.textContent = "";
    return;
  }
  row.hidden = false;
  avatar.src = user.user_metadata?.avatar_url || "";
  name.textContent = user.user_metadata?.full_name || user.email || "Signed in";
}

function updateProfileCard(user = currentUser) {
  const name = document.getElementById("profile-name");
  const email = document.getElementById("profile-email");
  const providers = document.getElementById("profile-providers");
  if (!name || !email || !providers) return;
  if (!user) {
    name.textContent = "Signed out";
    email.textContent = "-";
    providers.innerHTML = "";
    return;
  }
  name.textContent = user.user_metadata?.full_name || "Signed in";
  email.textContent = user.email || "No email";
  const providerList = user.app_metadata?.providers || [];
  providers.innerHTML = providerList.map((p) => {
    const label = p === "google" ? "Google" : p === "email" ? "Email password" : p;
    return `<span class="tag">${escapeHtml(label)}</span>`;
  }).join("");
}

function supabaseAuthMessage(error) {
  const msg = String(error?.message || "");
  const code = String(error?.code || "");
  
  if (msg.includes("Invalid login credentials")) return "Email or password is incorrect.";
  if (msg.includes("User already registered")) return "This email is already registered. Sign in instead.";
  if (msg.includes("Password should be")) return "Password must be at least 6 characters.";
  if (msg.includes("Email not confirmed")) return "Please confirm your email first.";
  
  // Rate limits
  if (msg.includes("Email rate limit exceeded") || code === "over_email_send_rate_limit") {
    return "Too many verification emails sent. Please wait a few minutes and try again.";
  }
  if (msg.includes("too many requests") || code === "too_many_requests") {
    return "Too many requests. Please slow down and try again in a few minutes.";
  }
  
  // Registration disabled
  if (msg.includes("Signups not allowed") || msg.includes("Signup is disabled")) {
    return "New registrations are currently disabled by the administrator.";
  }
  
  // Invalid formats
  if (msg.includes("Invalid email") || msg.includes("invalid format")) {
    return "Please enter a valid email address.";
  }
  
  return "Authentication failed: " + msg;
}

async function setAccountPassword() {
  if (!supabaseClient) { toast("Supabase not ready."); return; }
  const passwordInput = document.getElementById("profile-new-password");
  const confirmInput = document.getElementById("profile-confirm-password");
  const password = passwordInput?.value || "";
  const confirm = confirmInput?.value || "";
  if (password.length < 6) { toast("Password must be at least 6 characters."); return; }
  if (password !== confirm) { toast("Passwords do not match."); return; }
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    toast(supabaseAuthMessage(error));
  } else {
    if (passwordInput) passwordInput.value = "";
    if (confirmInput) confirmInput.value = "";
    toast("Password updated.");
  }
}

function updateSyncStatus(status) {
  const wrap = document.getElementById("sync-status");
  if (!wrap) return;
  const dot = wrap.querySelector(".sync-dot");
  const label = wrap.querySelector(".sync-label");
  if (!dot || !label) return;
  dot.className = `sync-dot ${status}`;
  
  if (status === "synced") {
    label.textContent = "Synced to Supabase";
  } else if (status === "syncing") {
    label.textContent = "Syncing...";
  } else if (status === "error") {
    label.textContent = "Sync error";
  } else {
    label.textContent = "Not signed in";
  }
}

// =============================================
// SUPABASE DATA FUNCTIONS
// =============================================

async function loadFromSupabase(userId) {
  if (!supabaseClient) return false;
  const loadToken = authLoadToken + 1;
  authLoadToken = loadToken;
  updateSyncStatus("syncing");
  try {
    const { data: cloudAccounts, error: accErr } = await supabaseClient
      .from("accounts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at");

    if (accErr) throw accErr;
    if (loadToken !== authLoadToken) return false;

    if (!cloudAccounts || cloudAccounts.length === 0) {
      accounts = [defaultAccount()];
      activeAccountId = accounts[0].id;
      accountData = {};
      for (const account of accounts) {
        accountData[account.id] = emptyJournalState(userId);
        await upsertAccountToSupabase(userId, account);
      }
      if (loadToken !== authLoadToken) return false;

      state = normalizeJournalState(accountData[activeAccountId]);
      syncMemoryState();
      renderCurrentAccount();
      await saveToSupabase({ quiet: true });
      if (loadToken !== authLoadToken) return false;

      updateSyncStatus("synced");
      return true;
    }

    accounts = cloudAccounts.map((row) => normalizeAccount({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    if (!accounts.some((a) => a.id === activeAccountId)) {
      activeAccountId = accounts[0].id;
    }

    accountData = {};
    for (const account of accounts) {
      accountData[account.id] = await loadAccountDataFromSupabase(userId, account.id);
      if (loadToken !== authLoadToken) return false;
    }

    state = normalizeJournalState(accountData[activeAccountId] || emptyJournalState(userId));
    syncMemoryState();
    renderCurrentAccount();
    updateSyncStatus("synced");
    return true;
  } catch (error) {
    console.warn("Could not load from Supabase, checking local backup...", error);
    if (loadToken === authLoadToken) {
      updateSyncStatus("offline");

      // Load active state from IndexedDB backup
      const backupState = await loadFromIndexedDB(userId, activeAccountId);
      const backupAccounts = await loadFromIndexedDB(userId, "accounts_list");

      if (backupState) {
        if (backupAccounts) {
          accounts = backupAccounts;
        }
        state = normalizeJournalState(backupState);
        accountData[activeAccountId] = clone(state);
        syncMemoryState();
        renderCurrentAccount();
        toast("Offline mode: Loaded from local backup.");
        return true;
      }

      toast("Could not load journal from Supabase.");
    }
    return false;
  }
}

async function loadAccountDataFromSupabase(userId, accountId) {
  const [
    tradesRes,
    cashRes,
    skippedRes,
    reviewsRes,
    metaRes
  ] = await Promise.all([
    supabaseClient.from("trades").select("*").eq("user_id", userId).eq("account_id", accountId).order("date"),
    supabaseClient.from("cash_transactions").select("*").eq("user_id", userId).eq("account_id", accountId).order("date"),
    supabaseClient.from("skipped_trades").select("*").eq("user_id", userId).eq("account_id", accountId).order("date"),
    supabaseClient.from("weekly_reviews").select("*").eq("user_id", userId).eq("account_id", accountId).order("week_of"),
    supabaseClient.from("journal_meta").select("*").eq("user_id", userId).eq("account_id", accountId).maybeSingle()
  ]);

  const errors = [tradesRes.error, cashRes.error, skippedRes.error, reviewsRes.error, metaRes.error].filter(Boolean);
  if (errors.length) throw errors[0];

  const meta = metaRes.data;

  return normalizeJournalState({
    ownerUid: userId,
    trades: (tradesRes.data || []).map(dbRowToTrade),
    cashTransactions: (cashRes.data || []).map(dbRowToCash),
    skippedTrades: (skippedRes.data || []).map(dbRowToSkipped),
    weeklyReviews: (reviewsRes.data || []).map(dbRowToReview),
    options: meta?.options || FIXED,
    settings: meta?.settings || {}
  });
}

function dbRowToTrade(row) {
  return normalizeTrade({
    id: row.id,
    date: row.date,
    session: row.session,
    entry: row.entry,
    level: row.level,
    tf: row.tf,
    setup: row.setup,
    mistake: row.mistake,
    hold: row.hold,
    marketCondition: row.market_condition,
    biasAlignment: row.bias_alignment,
    confirmationType: row.confirmation_type,
    slTpPlacement: row.sl_tp_placement,
    tpPlacement: row.tp_placement,
    patienceScore: row.patience_score,
    risk: row.risk,
    reward: row.reward,
    result: row.result,
    reason: row.reason,
    screenshotUrl: row.screenshot_url,
    pnl: row.pnl,
    cum: row.cum
  });
}

function dbRowToCash(row) {
  return normalizeCashTransaction({
    id: row.id,
    date: row.date,
    type: row.type,
    amount: row.amount,
    note: row.note,
    createdAt: row.created_at
  });
}

function dbRowToSkipped(row) {
  return normalizeSkippedTrade({
    id: row.id,
    date: row.date,
    session: row.session,
    level: row.level,
    tf: row.tf,
    direction: row.direction,
    skipReason: row.skip_reason,
    confidence: row.confidence,
    notes: row.notes,
    outcome: row.outcome,
    pipsMissed: row.pips_missed
  });
}

function dbRowToReview(row) {
  return normalizeWeeklyReview({
    id: row.id,
    weekOf: row.week_of,
    learned: row.learned,
    pattern: row.pattern,
    improve: row.improve,
    createdAt: row.created_at
  });
}

function tradeToDbRow(userId, accountId, trade) {
  return {
    id: trade.id,
    user_id: userId,
    account_id: accountId,
    date: trade.date,
    session: trade.session,
    entry: trade.entry,
    level: trade.level,
    tf: trade.tf,
    setup: trade.setup,
    mistake: trade.mistake,
    hold: trade.hold,
    market_condition: trade.marketCondition,
    bias_alignment: trade.biasAlignment,
    confirmation_type: trade.confirmationType,
    sl_tp_placement: trade.slTpPlacement,
    tp_placement: trade.tpPlacement,
    patience_score: trade.patienceScore,
    risk: trade.risk,
    reward: trade.reward,
    result: trade.result,
    reason: trade.reason,
    screenshot_url: trade.screenshotUrl,
    pnl: trade.pnl === "" ? null : trade.pnl,
    cum: trade.cum === "" ? null : trade.cum
  };
}

async function syncSupabaseTable(table, userId, accountId, rows, toDbRow) {
  const keep = new Set(rows.map((row) => row.id));
  if (rows.length > 0) {
    const { error } = await supabaseClient.from(table).upsert(rows.map((row) => toDbRow(userId, accountId, row)), { onConflict: "id" });
    if (error) throw error;
  }
  const { data: existing, error: fetchErr } = await supabaseClient.from(table).select("id").eq("user_id", userId).eq("account_id", accountId);
  if (fetchErr) throw fetchErr;
  const staleIds = (existing || []).map((row) => row.id).filter((id) => !keep.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await supabaseClient.from(table).delete().in("id", staleIds).eq("user_id", userId);
    if (delErr) throw delErr;
  }
}

async function saveToSupabase(options = {}) {
  const { quiet = false } = options;
  if (!supabaseClient || !currentUser) return;
  updateSyncStatus("syncing");
  const userId = currentUser.id;
  state.ownerUid = userId;
  if (!accounts.length) accounts = [defaultAccount()];

  syncMemoryState();

  try {
    await Promise.all(accounts.map(async (account) => {
      const accountId = account.id;
      const hasAccountData = Object.prototype.hasOwnProperty.call(accountData, accountId);
      await upsertAccountToSupabase(userId, normalizeAccount(account));
      if (!hasAccountData) return;
      const data = normalizeJournalState(accountData[accountId]);

      await Promise.all([
        syncSupabaseTable("trades", userId, accountId, data.trades, tradeToDbRow),
        syncSupabaseTable("cash_transactions", userId, accountId, data.cashTransactions, (uid, accId, c) => ({
          id: c.id, user_id: uid, account_id: accId,
          date: c.date, type: c.type, amount: c.amount || null, note: c.note, created_at: c.createdAt
        })),
        syncSupabaseTable("skipped_trades", userId, accountId, data.skippedTrades, (uid, accId, s) => ({
          id: s.id, user_id: uid, account_id: accId,
          date: s.date, session: s.session, level: s.level, tf: s.tf,
          direction: s.direction, skip_reason: s.skipReason, confidence: s.confidence,
          notes: s.notes, outcome: s.outcome, pips_missed: s.pipsMissed
        })),
        syncSupabaseTable("weekly_reviews", userId, accountId, data.weeklyReviews, (uid, accId, r) => ({
          id: r.id, user_id: uid, account_id: accId,
          week_of: r.weekOf, learned: r.learned, pattern: r.pattern, improve: r.improve, created_at: r.createdAt
        })),
        (async () => {
          const { error } = await supabaseClient.from("journal_meta").upsert({
            id: accountId,
            user_id: userId,
            account_id: accountId,
            options: data.options,
            settings: data.settings,
            updated_at: new Date().toISOString()
          }, { onConflict: "id" });
          if (error) throw error;
        })()
      ]);
    }));

    updateSyncStatus("synced");
  } catch (error) {
    console.warn("Could not save to Supabase", error);
    updateSyncStatus("offline");
    if (!quiet) toast("Cloud sync failed. Try again.");
  }
}

async function deleteTradeFromSupabase(tradeId) {
  if (!supabaseClient || !currentUser || !tradeId) return;
  const { error } = await supabaseClient
    .from("trades")
    .delete()
    .eq("id", tradeId)
    .eq("user_id", currentUser.id);
  if (error) console.warn("Could not delete trade from Supabase:", error);
}

async function deleteSkippedFromSupabase(tradeId) {
  if (!supabaseClient || !currentUser || !tradeId) return;
  const { error } = await supabaseClient
    .from("skipped_trades")
    .delete()
    .eq("id", tradeId)
    .eq("user_id", currentUser.id);
  if (error) console.warn("Could not delete skipped trade from Supabase:", error);
}

async function deleteCashFromSupabase(cashId) {
  if (!supabaseClient || !currentUser || !cashId) return;
  const { error } = await supabaseClient
    .from("cash_transactions")
    .delete()
    .eq("id", cashId)
    .eq("user_id", currentUser.id);
  if (error) console.warn("Could not delete cash transaction from Supabase:", error);
}

async function deleteReviewFromSupabase(reviewId) {
  if (!supabaseClient || !currentUser || !reviewId) return;
  const { error } = await supabaseClient
    .from("weekly_reviews")
    .delete()
    .eq("id", reviewId)
    .eq("user_id", currentUser.id);
  if (error) console.warn("Could not delete review from Supabase:", error);
}

async function upsertAccountToSupabase(userId, account) {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("accounts").upsert({
    id: account.id,
    user_id: userId,
    name: account.name,
    created_at: account.createdAt,
    updated_at: new Date().toISOString()
  }, { onConflict: "id" });
  if (error) throw error;
}

async function deleteRowFromSupabase(table, id) {
  if (!supabaseClient || !currentUser) return;
  const { error } = await supabaseClient.from(table).delete().eq("id", id).eq("user_id", currentUser.id);
  if (error) console.warn(`Could not delete from ${table}:`, error);
}

async function clearAccountFromSupabase(userId, accountId) {
  if (!supabaseClient) return;
  await Promise.all([
    supabaseClient.from("trades").delete().eq("user_id", userId).eq("account_id", accountId),
    supabaseClient.from("cash_transactions").delete().eq("user_id", userId).eq("account_id", accountId),
    supabaseClient.from("skipped_trades").delete().eq("user_id", userId).eq("account_id", accountId),
    supabaseClient.from("weekly_reviews").delete().eq("user_id", userId).eq("account_id", accountId),
    supabaseClient.from("journal_meta").delete().eq("user_id", userId).eq("account_id", accountId)
  ]);
}

async function handleAuthStateChange(event, session) {
  if (authStateBusy) return;
  authStateBusy = true;
  try {
    const user = session?.user || null;
    currentUser = user;
    updateUserRow(user);

    if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
      if (!user) {
        authLoadToken += 1;
        setAuthBusy(false);
        resetJournalState();
        renderCurrentAccount();
        showLoginScreen();
        updateSyncStatus("offline");
        recordDiagnostic("auth", "No active session restored", { event });
      } else {
        hideLoginScreen();
        setAuthBusy(false);
        resetJournalState(user.id);
        updateSyncStatus("syncing");
        recordDiagnostic("auth", "Restoring journal for signed-in user", { userId: user.id, event });
        await loadFromSupabase(user.id);
        updateSyncStatus("synced");
      }
      hideSplashScreen();
      return;
    }

    if (event === "SIGNED_OUT") {
      authLoadToken += 1;
      setAuthBusy(false);
      clearSessionAuthStorage();
      resetJournalState();
      renderCurrentAccount();
      showLoginScreen();
      updateSyncStatus("offline");
      recordDiagnostic("auth", "User signed out", { event });
      return;
    }

    if (event === "TOKEN_REFRESHED") {
      updateSyncStatus("synced");
      recordDiagnostic("auth", "Session refreshed", { event });
    }
  } catch (error) {
    console.warn("Auth state change failed", error);
    recordDiagnostic("error", "Auth state change failed", { error: String(error?.message || error), event });
    setAuthStatus("Authentication recovery failed. Please sign in again.", "error");
  } finally {
    authStateBusy = false;
  }
}

function initSupabaseAuth() {
  if (authInitStarted) return;
  authInitStarted = true;
  if (!initSupabase()) {
    updateSyncStatus("offline");
    showLoginScreen();
    hideSplashScreen();
    recordDiagnostic("error", "Supabase client initialisation failed");
    return;
  }
  supabaseReady = true;
  recordDiagnostic("auth", "Supabase client initialised", { url: supabaseConfig?.url });
  syncAuthProviderAvailability().catch((error) => {
    console.warn("Could not sync auth provider availability", error);
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    void handleAuthStateChange(event, session);
  });

  completeOAuthReturn().catch((error) => {
    console.warn("OAuth return handling failed", error);
    showLoginScreen();
    hideSplashScreen();
    setAuthStatus("Sign-in failed. Please try again.", "error");
  });
}

function switchTab(name, button) {
  destroyAllCharts();
  clearTimeout(analysisTimer);
  analysisTimer = null;
  document.querySelectorAll(".nav-btn, .bottom-nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById(`tab-${name}`)?.classList.add("active");
  if (name === "missed") renderSkippedTrades();
  if (name === "analysis") renderAnalysisWithDelay();
  if (name === "pnl") renderPnl();
  if (name === "weekly") renderWeeklyReviews();
  if (name === "mentor") renderAiMentor();
  if (name === "manage") renderManage();
  closeMobileMenu();
  refreshIcons();
}

function renderAiMentor() {
  const keyInput = document.getElementById("mentor-api-key");
  const modelInput = document.getElementById("mentor-model");
  const keyStatus = document.getElementById("mentor-key-status");
  const scope = document.getElementById("mentor-scope");
  const savedKey = mentorSessionKey || "";
  if (keyInput && !keyInput.value) keyInput.value = savedKey;
  if (modelInput) modelInput.value = DEFAULT_MENTOR_MODEL;
  if (keyStatus) keyStatus.textContent = savedKey ? "ready for this tab" : "not saved";
  if (scope) scope.textContent = `${activeAccount().name} - ${state.trades.length} trades, ${state.skippedTrades.length} missed`;
  refreshIcons();
}

function saveMentorSettings() {
  const key = document.getElementById("mentor-api-key")?.value.trim() || "";
  mentorSessionKey = key;
  renderAiMentor();
  toast(key ? "AI Mentor key ready for this tab only." : "Add API key to analyze.");
}

function clearMentorSettings() {
  mentorSessionKey = "";
  const keyInput = document.getElementById("mentor-api-key");
  const modelInput = document.getElementById("mentor-model");
  if (keyInput) keyInput.value = "";
  if (modelInput) modelInput.value = DEFAULT_MENTOR_MODEL;
  renderAiMentor();
  toast("AI Mentor key cleared.");
}

function mentorTradeSnapshot() {
  recalcCum();
  const closed = state.trades.filter((trade) => trade.result);
  const p = performance();
  const recentTrades = state.trades.slice(-60).map((trade, index) => ({
    no: state.trades.length - Math.min(state.trades.length, 60) + index + 1,
    date: trade.date,
    session: trade.session,
    side: trade.entry,
    level: trade.level,
    tf: trade.tf,
    setup: trade.setup,
    result: trade.result || "OPEN",
    risk: trade.risk,
    reward: trade.reward,
    rr: calcRR(trade.risk, trade.reward),
    pnl: trade.pnl,
    mistake: trade.mistake,
    hold: trade.hold,
    marketCondition: trade.marketCondition,
    biasAlignment: trade.biasAlignment,
    confirmationType: trade.confirmationType,
    slPlacement: trade.slTpPlacement,
    tpPlacement: trade.tpPlacement,
    patienceScore: trade.patienceScore,
    notes: trade.reason
  }));
  const missedTrades = state.skippedTrades.slice(-40).map((trade, index) => ({
    no: state.skippedTrades.length - Math.min(state.skippedTrades.length, 40) + index + 1,
    date: trade.date,
    session: trade.session,
    level: trade.level,
    tf: trade.tf,
    direction: trade.direction,
    skipReason: trade.skipReason,
    confidence: trade.confidence,
    outcome: trade.outcome,
    pipsMissed: trade.pipsMissed,
    notes: trade.notes
  }));
  return {
    account: activeAccount().name,
    generatedAt: new Date().toISOString(),
    summary: {
      totalTrades: state.trades.length,
      closedTrades: closed.length,
      wins: p.wins.length,
      losses: p.losses.length,
      breakeven: p.bes.length,
      winRate: `${p.winRate.toFixed(1)}%`,
      totalPnl: p.totalPnl,
      profitFactor: +p.profitFactor.toFixed(2),
      expectancy: +p.expectancy.toFixed(1),
      maxDrawdown: p.maxDrawdown,
      missedTrades: state.skippedTrades.length,
      ...accountBalanceSummary(),
      cashEntries: (state.cashTransactions || []).length
    },
    cashTransactions: (state.cashTransactions || []).slice(-20),
    recentTrades,
    missedTrades
  };
}

function mentorPrompt(snapshot) {
  return [
    "You are a brutally honest trading mentor for an XAUUSD discretionary trader.",
    "Analyze ONLY the provided journal JSON data. Be eye-opening, direct, practical, and specific. Do not flatter, motivate, or write generic advice.",
    "Use Roman Urdu or simple English only. If the trader's pattern is weak, say it clearly. If data is limited, say exactly what cannot be judged yet.",
    "",
    "Perform a deep analysis across ALL of the following areas:",
    "",
    "SECTION 1 — BEHAVIORAL & PSYCHOLOGICAL ANALYSIS:",
    "- Revenge Trading Detection: Look for clusters of rapid trades immediately after a LOSS (same day, 2+ trades after loss). Flag if this pattern exists with specific dates/examples.",
    "- FOMO Detection: Identify trades where patienceScore <= 2 AND mistake field contains \"FOMO trade\" or \"Early entry\". Calculate % of total trades these represent.",
    "- Over-Trading Detection: Find days/sessions with 3+ trades and check if those days have lower win rate than average. Report the correlation.",
    "- Discipline Score per week: Calculate (trades with patienceScore >= 4 + trades with mistake=\"No mistake\") / total trades * 100. Give a letter grade A-F.",
    "",
    "SECTION 2 — RISK & TRADE MANAGEMENT:",
    "- Leaving Money On Table: Check hold quality field. Count trades where hold=\"Early exit\" vs \"Held full TP\". Calculate pip difference. Report: \"You cut X trades early, potentially missing Y pips total.\"",
    "- Holding Losers: Look for LOSS trades and note reason/notes field for patterns like \"moved SL\", \"held too long\", \"hope\".",
    "- SL/TP Placement Analysis: Group trades by slTpPlacement field. Which placement type has highest win rate? Report with numbers.",
    "- Risk Consistency: Calculate standard deviation of risk field across all trades. High deviation = inconsistent sizing. Flag if >50% variance.",
    "",
    "SECTION 3 — BLIND SPOTS & ENVIRONMENT:",
    "- Market Condition: Group by marketCondition field. Which condition has highest/lowest win rate? Should trader avoid any condition?",
    "- Day of Week: Extract weekday from trade.date. Which day is most profitable? Which day should trader avoid?",
    "- Session Performance: Group by session field. Best and worst session with exact win rates and total P&L per session.",
    "- Level Performance: Group by level field. Best and worst level. Minimum 3 trades to qualify for recommendation.",
    "- TF Performance: Group by tf field. Best TF by win rate.",
    "",
    "SECTION 4 — NLP ON NOTES:",
    "- Scan all trade.reason (notes) fields for emotional words: \"anxious\", \"fear\", \"rushed\", \"confident\", \"missed\", \"revenge\", \"hope\", \"frustrated\", \"excited\", \"doubt\".",
    "- Correlate presence of negative words with LOSS trades. Report: \"Trades with negative emotional language: X% win rate vs trades without: Y% win rate.\"",
    "- Extract most common setup descriptions from notes.",
    "",
    "SECTION 5 — GENERATIVE COACHING OUTPUT:",
    "Return EXACTLY this structure with these exact ## headers (no extra sections, no missing sections):",
    "",
    "## TRADING REPORT CARD",
    "Overall Grade: [A/B/C/D/F]",
    "Explanation: [2 sentences]",
    "",
    "## BRUTAL TRUTH",
    "[What is really happening, no sugarcoating, evidence-based]",
    "",
    "## BEHAVIORAL ALERTS",
    "- Revenge Trading: [detected/not detected, with evidence]",
    "- FOMO Score: [X% of trades show FOMO behavior]",
    "- Over-trading: [detected/not detected]",
    "- Discipline Score: [X% — Grade B]",
    "",
    "## WHAT IS WORKING",
    "[Specific levels, sessions, confirmations that actually profit]",
    "",
    "## WHAT IS COSTING MONEY",
    "[Top 3 specific mistakes with pip cost estimate]",
    "",
    "## BLIND SPOT REPORT",
    "[Session to avoid, day to avoid, market condition to avoid]",
    "",
    "## MISSED TRADE LESSON",
    "[Analysis of skipped trades vs actual trades]",
    "",
    "## NEXT 5-TRADE RULES",
    "1. [Specific, numbered, actionable rules only]",
    "2.",
    "3.",
    "4.",
    "5.",
    "",
    "## STOP IMMEDIATELY",
    "[One behavior to stop, with evidence from journal]",
    "",
    "## REPEAT IMMEDIATELY",
    "[One thing working that must be repeated]",
    "",
    "## WEEKEND HOMEWORK",
    "[3 specific actionable tasks for next week based on data]",
    "",
    "Journal data JSON:",
    JSON.stringify(snapshot)
  ].join("\n");
}

function formatMentorInline(text) {
  return escapeHtml(text || "")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function formatMentorBlock(body) {
  const trimmed = (body || "").trim();
  if (!trimmed) return "";
  const blocks = trimmed.split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return "";
    const isOrdered = lines.every((line) => /^\d+\.\s/.test(line));
    const isBulleted = lines.every((line) => /^[-*]\s/.test(line));
    if (isOrdered) {
      return `<ol>${lines.map((line) => `<li>${formatMentorInline(line.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol>`;
    }
    if (isBulleted) {
      return `<ul>${lines.map((line) => `<li>${formatMentorInline(line.replace(/^[-*]\s*/, ""))}</li>`).join("")}</ul>`;
    }
    if (lines.length > 1 && lines.some((line) => /^[-*]\s/.test(line))) {
      const parts = [];
      let bulletBuffer = [];
      const flushBullets = () => {
        if (bulletBuffer.length) {
          parts.push(`<ul>${bulletBuffer.map((item) => `<li>${item}</li>`).join("")}</ul>`);
          bulletBuffer = [];
        }
      };
      lines.forEach((line) => {
        if (/^[-*]\s/.test(line)) {
          bulletBuffer.push(formatMentorInline(line.replace(/^[-*]\s*/, "")));
        } else {
          flushBullets();
          parts.push(`<p>${formatMentorInline(line)}</p>`);
        }
      });
      flushBullets();
      return parts.join("");
    }
    return `<p>${formatMentorInline(lines.join("<br>"))}</p>`;
  }).join("");
}

function renderMentorMarkdown(text) {
  const raw = (text || "").trim();
  if (!raw) return "";
  if (!/^##\s+/m.test(raw)) {
    return `<section class="mentor-section-card"><div class="mentor-section-body">${formatMentorBlock(raw)}</div></section>`;
  }
  return raw.split(/\n(?=##\s+)/).map((section) => {
    const cleaned = section.replace(/^##\s+/, "").trim();
    const newline = cleaned.indexOf("\n");
    const title = (newline === -1 ? cleaned : cleaned.slice(0, newline)).trim().toUpperCase();
    const body = newline === -1 ? "" : cleaned.slice(newline + 1);
    const icon = MENTOR_SECTION_ICONS[title] || "ðŸ“Š";
    return `
      <section class="mentor-section-card">
        <header class="mentor-section-head">
          <span class="mentor-section-icon" aria-hidden="true">${icon}</span>
          <h3>${escapeHtml(title)}</h3>
        </header>
        <div class="mentor-section-body">${formatMentorBlock(body)}</div>
      </section>
    `;
  }).join("");
}

function buildLocalMentorFallback(snapshot) {
  const summary = snapshot?.summary || {};
  const recentTrades = snapshot?.recentTrades || [];
  const missedTrades = snapshot?.missedTrades || [];
  const strongTrades = recentTrades.filter((trade) => trade.result === "WIN").length;
  const weakTrades = recentTrades.filter((trade) => trade.result === "LOSS").length;
  const commonMistakes = recentTrades.reduce((acc, trade) => {
    if (trade.mistake) acc[trade.mistake] = (acc[trade.mistake] || 0) + 1;
    return acc;
  }, {});
  const topMistake = Object.entries(commonMistakes).sort((a, b) => b[1] - a[1])[0];
  const body = [
    "## LOCAL FALLBACK REVIEW",
    "Overall Grade: C",
    `Explanation: The live AI model was unavailable, so this fallback review is based on your recorded journal patterns and risk discipline.`,
    "",
    "## BRUTAL TRUTH",
    `You have ${summary.totalTrades || 0} logged trades with a ${summary.winRate || "0%"} win rate and ${summary.missedTrades || 0} missed trades. The data is limited, but the pattern suggests you are still relying on emotion and inconsistent execution.`,
    "",
    "## BEHAVIORAL ALERTS",
    `- Revenge Trading: ${weakTrades > 0 ? "Possible pattern detected; check trades immediately following losses." : "Not enough evidence."}`,
    `- FOMO Score: ${recentTrades.filter((trade) => Number(trade.patienceScore) <= 2).length} trades show low patience or rushed entries.`,
    `- Over-trading: ${recentTrades.filter((trade) => trade.session && trade.session.includes("London")).length > 0 ? "Possible over-trading during busy sessions." : "Not enough evidence."}`,
    `- Discipline Score: ${Math.round(((strongTrades + recentTrades.filter((trade) => trade.mistake === "No mistake").length) / Math.max(1, recentTrades.length)) * 100)}% — Grade C`,
    "",
    "## WHAT IS WORKING",
    `Your strongest area appears to be ${recentTrades[0]?.session || "session consistency"} when entries are clean and the setup is simple.`,
    "",
    "## WHAT IS COSTING MONEY",
    `${topMistake ? `${topMistake[0]} appears ${topMistake[1]} time(s).` : "Review your notes for repeated mistakes and tighten the execution plan."}`,
    "",
    "## BLIND SPOT REPORT",
    `Skipped trades: ${missedTrades.length}. Treat missed setups as feedback, not as proof that the market was always wrong.`,
    "",
    "## MISSED TRADE LESSON",
    "The missed-trade list is your best data source for discipline. Review the missed entries before taking more risk.",
    "",
    "## NEXT 5-TRADE RULES",
    "1. Only take a trade when the setup matches your plan exactly.",
    "2. Do not enter immediately after a loss.",
    "3. Respect your risk size even when the trade feels obvious.",
    "4. Review your missed trades before trading again.",
    "5. Keep notes objective and avoid emotional language.",
    "",
    "## STOP IMMEDIATELY",
    "Stop treating every setup as a must-trade. Your poor-quality entries are costing execution quality.",
    "",
    "## REPEAT IMMEDIATELY",
    "Repeat the clean setups that produce consistent wins and keep your notes clear.",
    "",
    "## WEEKEND HOMEWORK",
    "1. Review the last 10 trades for repeated mistakes.",
    "2. Compare missed trades to executed trades and find your biggest leak.",
    "3. Write one rule for managing your next session before trading."
  ].join("\n");
  const rawHtml = `<article class="mentor-review">${renderMentorMarkdown(body)}</article>`;
  return typeof DOMPurify !== "undefined"
    ? DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS: ["article", "section", "header", "h3", "div", "p", "ul", "ol", "li", "strong", "em", "b", "span", "br"], ALLOWED_ATTR: ["class", "aria-label", "aria-hidden"] })
    : rawHtml;
}

async function runAiMentorReview() {
  if (mentorRequestInProgress) {
    toast("Analysis already running. Please wait.");
    return;
  }
  const now = Date.now();
  if (now - lastMentorRequestTime < MENTOR_COOLDOWN_MS) {
    const remaining = Math.ceil((MENTOR_COOLDOWN_MS - (now - lastMentorRequestTime)) / 1000);
    toast(`Wait ${remaining}s before running another analysis.`);
    return;
  }
  mentorRequestInProgress = true;
  lastMentorRequestTime = now;

  const output = document.getElementById("mentor-output");
  const keyInput = document.getElementById("mentor-api-key");
  const key = (keyInput?.value || mentorSessionKey || "").trim();
  const model = DEFAULT_MENTOR_MODEL;
  if (!output) {
    mentorRequestInProgress = false;
    return;
  }
  if (!key) {
    toast("Add your OpenRouter API key first.");
    output.innerHTML = `<div class="empty-state compact-empty"><div><strong>API key required</strong><span>Paste your OpenRouter key for this tab.</span></div></div>`;
    mentorRequestInProgress = false;
    return;
  }
  if (!state.trades.length && !state.skippedTrades.length) {
    toast("No journal data to analyze.");
    output.innerHTML = `<div class="empty-state compact-empty"><div><strong>No trades yet</strong><span>Log trades or missed trades first.</span></div></div>`;
    mentorRequestInProgress = false;
    return;
  }
  mentorSessionKey = key;
  renderAiMentor();
  output.innerHTML = `<div class="mentor-loading"><span class="upload-spinner"></span><b>Analyzing journal...</b></div>`;
  diagnosticsState.ai = { status: "requesting" };
  updateDiagnosticsPanel();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-OpenRouter-Title": "Gold Trading Journal"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a strict XAUUSD trading mentor. Respond only in Roman Urdu or simple English. Be brutally honest, evidence-based, practical, and concise." },
          { role: "user", content: mentorPrompt(mentorTradeSnapshot()) }
        ],
        temperature: 0.35,
        max_tokens: 2500
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenRouter request failed (${response.status})`);
    }
    const content = data?.choices?.[0]?.message?.content || "";
    const scope = document.getElementById("mentor-scope");
    if (scope) scope.textContent = `model: ${data?.model || model}`;
    const rawHtml = `<article class="mentor-review">${renderMentorMarkdown(content)}</article>`;
    output.innerHTML = typeof DOMPurify !== "undefined"
      ? DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS: ["article", "section", "header", "h3", "div", "p", "ul", "ol", "li", "strong", "em", "b", "span", "br"], ALLOWED_ATTR: ["class", "aria-label", "aria-hidden"] })
      : rawHtml;
    diagnosticsState.ai = { status: "ready", lastModel: data?.model || model };
  } catch (error) {
    console.warn("AI Mentor request failed", error);
    const fallbackHtml = buildLocalMentorFallback(mentorTradeSnapshot());
    output.innerHTML = fallbackHtml;
    diagnosticsState.ai = { status: "fallback", error: error.message || "network error" };
    toast("AI Mentor request failed. Showing local fallback analysis.");
  } finally {
    mentorRequestInProgress = false;
    updateDiagnosticsPanel();
  }
}

function exportRows() {
  recalcCum();
  const headers = ["#", "Date", "Session", "Side", "Level", "TF", "Setup", "Mistake", "Hold", "Market Condition", "Bias Alignment", "Confirmation Type", "SL Placement", "TP Placement", "Patience Score", "Risk($)", "Reward($)", "RR", "Result", "P&L($)", "Cumul P&L", "Notes"];
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
    trade.tpPlacement,
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
  downloadText(csv, "Gold_Journal.csv");
}

function exportSkippedCSV() {
  const { headers, rows } = skippedExportRows(filteredSkippedTrades().map(({ trade }) => trade));
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadText(csv, "Skipped_Trades.csv");
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
  wsTrades["!cols"] = [4, 12, 24, 8, 14, 8, 12, 18, 18, 18, 22, 20, 18, 18, 14, 10, 12, 9, 9, 10, 12, 34].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsTrades, "Trade Log");

  const p = performance();
  const summary = [
    ["Metric", "Value"],
    ["Account Balance", +accountBalanceSummary().currentBalance.toFixed(1)],
    ["Total Deposits", +accountBalanceSummary().deposits.toFixed(1)],
    ["Total Withdrawals", +accountBalanceSummary().withdrawals.toFixed(1)],
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

  const cashSheet = [
    ["Date", "Type", "Amount", "Note"],
    ...(state.cashTransactions || []).map((entry) => [
      formatDateDisplay(entry.date),
      entry.type,
      +entry.amount,
      entry.note || ""
    ])
  ];
  const wsCash = XLSX.utils.aoa_to_sheet(cashSheet);
  wsCash["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, wsCash, "Cash Flow");

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

function preloadReportImages(report) {
  const images = Array.from(report.querySelectorAll(".r-card-image"));
  if (!images.length) return Promise.resolve();
  return Promise.all(images.map((img) => new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    setTimeout(done, 4500);
  }))).then(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

async function exportPDF() {
  const range = reportRange();
  const report = document.getElementById("print-report");
  if (!report) return;
  report.innerHTML = buildReportHtml(range);
  const title = document.title;
  document.title = `Gold_Trading_Journal_${range.from || "all"}_${range.to || "trades"}`;
  document.body.classList.add("printing-report");
  await preloadReportImages(report);
  window.print();
  setTimeout(() => {
    document.title = title;
    document.body.classList.remove("printing-report");
    report.innerHTML = "";
  }, 700);
}

function downloadText(text, filename) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  a.rel = "noopener noreferrer";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function seedDemoTrades() {
  if (state.trades.length && !confirm("Demo trades will be added to your current journal. Continue?")) return;
  const samples = [
    ["London (12pm-2pm)", "BUY", "RBS/TJL1", "5m", "A+", "No mistake", "Held full TP", 22, 60, "WIN", "Clean retest after London sweep."],
    ["New York (5pm-8pm)", "SELL", "QML", "15m", "A", "Early entry", "Early exit", 28, 52, "LOSS", "Entered before confirmation candle."],
    ["Post-London (2pm-4pm)", "BUY", "FIB", "5m", "B", "Fear exit", "Early exit", 18, 30, "BE", "Moved stop after hesitation."],
    ["London (12pm-2pm)", "SELL", "SBR/TJL1", "1m", "A+", "No mistake", "Partial + runner", 20, 75, "WIN", "Strong rejection from marked level."],
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
  exposeAuthApi();
  purgeLegacyJournalStorage();
  migrateOldCaches();
  resetJournalState();
  applyReportPreset();
  renderCurrentAccount();
  setAuthMode("signin");
  wireAuthUi();
  refreshIcons();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=20260628-supabase-only-v27")
      .catch((err) => console.warn("Service worker registration failed:", err));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("cash-modal")?.hidden) closeCashModal();
    if (event.key === "Escape" && !document.getElementById("trade-modal")?.hidden) closeTradeModal();
    if (event.key === "Escape" && !document.getElementById("view-trade-modal")?.hidden) closeViewTradeModal();
    if (event.key === "Escape" && !document.getElementById("skipped-modal")?.hidden) closeSkippedModal();
  });
  document.getElementById("trade-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "trade-modal") closeTradeModal();
  });
  document.getElementById("view-trade-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "view-trade-modal") closeViewTradeModal();
  });
  document.getElementById("skipped-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "skipped-modal") closeSkippedModal();
  });
  document.getElementById("cash-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "cash-modal") closeCashModal();
  });
  document.getElementById("modal-screenshot-input")?.addEventListener("change", (event) => {
    handleScreenshotFile(event.target.files?.[0]);
  });
  const screenshotDropzone = document.getElementById("modal-screenshot-dropzone");
  if (screenshotDropzone) {
    ["dragenter", "dragover"].forEach((type) => {
      screenshotDropzone.addEventListener(type, (event) => {
        event.preventDefault();
        screenshotDropzone.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      screenshotDropzone.addEventListener(type, (event) => {
        event.preventDefault();
        screenshotDropzone.classList.remove("drag-over");
      });
    });
    screenshotDropzone.addEventListener("drop", (event) => {
      handleScreenshotFile(event.dataTransfer?.files?.[0]);
    });
  }
  void initSupabaseAuth();
}

function hideSplashScreen() {
  const splash = document.getElementById("splash-screen");
  if (!splash || splash.classList.contains("hiding") || splash.classList.contains("hidden-done")) return;
  splash.classList.add("hiding");
  setTimeout(() => {
    splash.classList.add("hidden-done");
  }, 450);
}


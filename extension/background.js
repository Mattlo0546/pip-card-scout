/* global PIP_CONFIG */
importScripts("config.js");

const DEFAULT_SETTINGS = Object.freeze({ showBot: true });
const SESSION_KEY = "pipSession";
let refreshPromise = null;
const ALLOWED_CATEGORIES = new Set([
  "fashion", "groceries", "dining", "travel", "transit", "fuel",
  "subscriptions", "electronics", "business", "online", "general"
]);

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function apiUrl(path) {
  const base = String(PIP_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(base)) {
    throw new ApiError("Pip's API URL is not configured safely.", 503);
  }
  return `${base}${path}`;
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function errorMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  return typeof payload.error === "string" ? payload.error : fallback;
}

async function getSession() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] || null;
}

async function setSession(session) {
  if (session?.accessToken && session?.refreshToken) {
    await chrome.storage.session.set({ [SESSION_KEY]: session });
  } else {
    await chrome.storage.session.remove(SESSION_KEY);
  }
}

async function publicApi(path, { method = "GET", body } = {}) {
  const response = await fetch(apiUrl(path), {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new ApiError(errorMessage(payload, "Pip's service is unavailable."), response.status);
  return payload;
}

async function refreshSession(session) {
  try {
    const payload = await publicApi("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: session.refreshToken }
    });
    if (!payload?.session?.accessToken) throw new Error("No refreshed session returned.");
    await setSession(payload.session);
    return payload.session;
  } catch (error) {
    await setSession(null);
    throw error;
  }
}

function rotateSession(session) {
  if (!refreshPromise) {
    refreshPromise = refreshSession(session).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function validSession() {
  const session = await getSession();
  if (!session?.accessToken) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Number(session.expiresAt || 0) > now + 60) return session;
  return rotateSession(session);
}

async function authenticatedApi(path, { method = "GET", body, retry = true } = {}) {
  const session = await validSession();
  if (!session) throw new ApiError("Sign in to continue.", 401);
  const response = await fetch(apiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await readPayload(response);
  if (response.status === 401 && retry) {
    await rotateSession(session);
    return authenticatedApi(path, { method, body, retry: false });
  }
  if (!response.ok) throw new ApiError(errorMessage(payload, "Pip's service is unavailable."), response.status);
  return payload;
}

function safeTabUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url;
  } catch {
    // Unsupported pages are handled below.
  }
  return null;
}

async function ensureContentScript(tabId) {
  if (!Number.isInteger(tabId)) throw new ApiError("No active checkout tab was found.", 400);
  const tab = await chrome.tabs.get(tabId);
  if (!safeTabUrl(tab.url)) throw new ApiError("Pip runs on secure HTTPS checkout pages.", 400);
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  return { ok: true };
}

function normalizeContext(value, tabUrl) {
  if (!value || typeof value !== "object") throw new ApiError("The checkout context is missing.", 400);
  const merchant = typeof value.merchant === "string" ? value.merchant.trim().slice(0, 120) : "";
  const category = typeof value.category === "string" ? value.category.trim().toLowerCase() : "";
  const amountPence = Math.round(Number(value.amountPence));
  const confidence = Number(value.confidence);
  const currency = typeof value.currency === "string" ? value.currency.toUpperCase() : "";
  if (!merchant || !ALLOWED_CATEGORIES.has(category)) throw new ApiError("Pip could not identify this checkout.", 400);
  if (!Number.isSafeInteger(amountPence) || amountPence < 1 || amountPence > 100000000) {
    throw new ApiError("Pip could not read a safe checkout total.", 400);
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new ApiError("Invalid category confidence.", 400);
  if (currency !== "GBP") throw new ApiError("Pip currently supports GBP checkouts only.", 422);
  const parsedTab = safeTabUrl(tabUrl);
  if (!parsedTab) throw new ApiError("Pip cannot run on this page.", 400);
  return {
    merchant,
    category,
    amountPence,
    confidence,
    currency,
    inferredMcc: typeof value.inferredMcc === "string" ? value.inferredMcc.slice(0, 8) : null,
    amountDetected: value.amountDetected !== false,
    url: parsedTab.origin
  };
}

async function getState() {
  const session = await validSession();
  if (!session) return { signedIn: false, settings: DEFAULT_SETTINGS };
  const [catalog, wallet, preferences, history, sync] = await Promise.all([
    authenticatedApi("/api/v1/catalog"),
    authenticatedApi("/api/v1/wallet"),
    authenticatedApi("/api/v1/settings"),
    authenticatedApi("/api/v1/history"),
    chrome.storage.sync.get("pipSettings")
  ]);
  return {
    signedIn: true,
    user: session.user,
    products: catalog.products || [],
    cards: wallet.cards || [],
    preferences: preferences.settings || { cloudHistory: false, retentionDays: 90 },
    history: history.events || [],
    settings: { ...DEFAULT_SETTINGS, ...(sync.pipSettings || {}) }
  };
}

async function handleMessage(message, sender) {
  const contentScriptActions = new Set(["PIP_RECOMMEND", "PIP_GET_SETTINGS"]);
  if (sender.tab && !contentScriptActions.has(message?.type)) {
    throw new ApiError("This action is only available from Pip's extension pages.", 403);
  }
  switch (message?.type) {
    case "PIP_AUTH": {
      const action = message.mode === "sign-up" ? "sign-up" : "sign-in";
      const payload = await publicApi(`/api/v1/auth/${action}`, {
        method: "POST",
        body: { email: message.email, password: message.password }
      });
      if (payload.session?.accessToken) await setSession(payload.session);
      return {
        ok: true,
        emailConfirmationRequired: Boolean(payload.emailConfirmationRequired),
        user: payload.session?.user || null
      };
    }
    case "PIP_SIGN_OUT": {
      try {
        await authenticatedApi("/api/v1/auth/sign-out", { method: "POST", body: {} });
      } catch {
        // Local token removal still completes sign out if the network is unavailable.
      }
      await setSession(null);
      return { ok: true };
    }
    case "PIP_DELETE_ACCOUNT": {
      const result = await authenticatedApi("/api/v1/account", { method: "DELETE" });
      await setSession(null);
      return { ok: true, ...result };
    }
    case "PIP_GET_STATE":
      return { ok: true, state: await getState() };
    case "PIP_GET_SETTINGS": {
      const stored = await chrome.storage.sync.get("pipSettings");
      return { ok: true, settings: { ...DEFAULT_SETTINGS, ...(stored.pipSettings || {}) } };
    }
    case "PIP_ENSURE_TAB":
      return ensureContentScript(Number(message.tabId));
    case "PIP_ADD_CARD":
      return { ok: true, ...(await authenticatedApi("/api/v1/wallet", {
        method: "POST",
        body: { productId: message.productId, nickname: message.nickname, lastFour: message.lastFour }
      })) };
    case "PIP_TOGGLE_CARD":
      return { ok: true, ...(await authenticatedApi(`/api/v1/wallet/${encodeURIComponent(message.cardId)}`, {
        method: "PATCH",
        body: { enabled: Boolean(message.enabled) }
      })) };
    case "PIP_REMOVE_CARD":
      return { ok: true, ...(await authenticatedApi(`/api/v1/wallet/${encodeURIComponent(message.cardId)}`, {
        method: "DELETE"
      })) };
    case "PIP_UPDATE_HISTORY":
      return { ok: true, ...(await authenticatedApi("/api/v1/settings", {
        method: "PATCH",
        body: { cloudHistory: Boolean(message.enabled) }
      })) };
    case "PIP_RECOMMEND": {
      if (!sender.tab?.id || !sender.tab.url) throw new ApiError("Recommendations must come from the active checkout tab.", 400);
      const context = normalizeContext(message.context, sender.tab.url);
      const result = await authenticatedApi("/api/v1/recommend", { method: "POST", body: context });
      chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#173f3a" });
      chrome.action.setBadgeText({ tabId: sender.tab.id, text: result.recommendation.isTie ? "TIE" : "BEST" });
      chrome.action.setTitle({
        tabId: sender.tab.id,
        title: result.recommendation.isTie
          ? `${result.recommendation.tiedCards.join(" and ")} tie for this checkout`
          : `${result.recommendation.winner.cardName} is best for this checkout`
      });
      return { ok: true, ...result };
    }
    default:
      throw new ApiError("Unknown Pip action.", 400);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get("pipSettings");
  if (!stored.pipSettings) await chrome.storage.sync.set({ pipSettings: DEFAULT_SETTINGS });
  await chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Pip could not complete that action.",
      status: Number(error?.status || 500)
    }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  chrome.action.setBadgeText({ tabId, text: "" });
  chrome.action.setTitle({ tabId, title: "Ask Pip which card to use" });
});

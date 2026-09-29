(function initialisePopup() {
  "use strict";

  const elements = {
    loading: document.querySelector("#loading-view"),
    auth: document.querySelector("#auth-view"),
    wallet: document.querySelector("#wallet-view"),
    authForm: document.querySelector("#auth-form"),
    authEmail: document.querySelector("#auth-email"),
    authPassword: document.querySelector("#auth-password"),
    authSubmit: document.querySelector("#auth-submit"),
    authMode: document.querySelector("#auth-mode"),
    authStatus: document.querySelector("#auth-status"),
    checkoutTitle: document.querySelector("#checkout-title"),
    checkoutDetail: document.querySelector("#checkout-detail"),
    confidenceChip: document.querySelector("#confidence-chip"),
    runButton: document.querySelector("#run-pip"),
    runStatus: document.querySelector("#run-status"),
    cardList: document.querySelector("#card-list"),
    enabledCount: document.querySelector("#enabled-count"),
    addPanel: document.querySelector("#add-card-panel"),
    addForm: document.querySelector("#add-card-form"),
    productSelect: document.querySelector("#product-select"),
    nickname: document.querySelector("#card-nickname"),
    lastFour: document.querySelector("#card-last-four"),
    addButton: document.querySelector("#add-card-button"),
    walletStatus: document.querySelector("#wallet-status"),
    historyToggle: document.querySelector("#history-toggle"),
    activityList: document.querySelector("#activity-list"),
    accountEmail: document.querySelector("#account-email"),
    signOut: document.querySelector("#sign-out"),
    deleteAccount: document.querySelector("#delete-account")
  };

  let authMode = "sign-in";
  let activeTabId = null;
  let currentContext = null;
  let appState = null;

  function formatMoney(pence, currency) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(pence || 0) / 100);
  }

  async function call(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || "Pip could not complete that action.");
    return result;
  }

  function show(view) {
    elements.loading.hidden = view !== "loading";
    elements.auth.hidden = view !== "auth";
    elements.wallet.hidden = view !== "wallet";
  }

  function productById(id) {
    return appState?.products?.find((product) => product.id === id) || null;
  }

  function buildMiniCard(product) {
    const face = document.createElement("div");
    face.className = "mini-card";
    face.style.setProperty("--card-a", product?.artworkFrom || "#173f3a");
    face.style.setProperty("--card-b", product?.artworkTo || "#2f7467");
    face.style.setProperty("--card-accent", product?.artworkAccent || "#c8ff62");
    const name = document.createElement("strong");
    name.textContent = product?.name || "Card";
    const mark = document.createElement("span");
    mark.textContent = "PIP";
    face.append(name, mark);
    return face;
  }

  function setWalletStatus(message, tone = "") {
    elements.walletStatus.textContent = message;
    elements.walletStatus.dataset.tone = tone;
  }

  function renderWallet() {
    const cards = appState.cards || [];
    const enabled = cards.filter((card) => card.enabled).length;
    elements.enabledCount.textContent = `${enabled} enabled`;
    elements.cardList.replaceChildren();

    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "empty-wallet";
      empty.innerHTML = "<strong>Your wallet is empty.</strong><span>Add the card products you already own. Never enter a full card number.</span>";
      elements.cardList.append(empty);
    }

    cards.forEach((card) => {
      const product = productById(card.cardProductId);
      const comparisonReady = product?.comparisonStatus !== "catalog_only";
      const row = document.createElement("article");
      row.className = `wallet-card${card.enabled && comparisonReady ? "" : " wallet-card-disabled"}`;
      const copy = document.createElement("div");
      copy.className = "card-copy";
      const name = document.createElement("strong");
      name.textContent = card.nickname || product?.name || "Card";
      const meta = document.createElement("span");
      meta.textContent = `${card.nickname && product ? `${product.name} · ` : ""}${card.lastFour ? `ending ${card.lastFour}` : product?.issuer || "Wallet card"}${comparisonReady ? "" : " · rewards review pending"}`;
      copy.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "card-actions";
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "toggle-wrap";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = card.enabled && comparisonReady;
      checkbox.disabled = !comparisonReady;
      checkbox.setAttribute("aria-label", comparisonReady
        ? `${card.enabled ? "Disable" : "Enable"} ${name.textContent}`
        : `${name.textContent} cannot be compared until its reward terms are verified`);
      const toggleUi = document.createElement("i");
      toggleUi.setAttribute("aria-hidden", "true");
      toggleLabel.append(checkbox, toggleUi);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${name.textContent}`);
      actions.append(toggleLabel, remove);

      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        try {
          await call({ type: "PIP_TOGGLE_CARD", cardId: card.id, enabled: checkbox.checked });
          card.enabled = checkbox.checked;
          renderWallet();
          updateRunState();
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          setWalletStatus(error.message, "error");
        } finally {
          checkbox.disabled = false;
        }
      });

      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await call({ type: "PIP_REMOVE_CARD", cardId: card.id });
          appState.cards = cards.filter((item) => item.id !== card.id);
          setWalletStatus("Card removed.", "success");
          renderWallet();
          renderProductOptions();
          updateRunState();
        } catch (error) {
          setWalletStatus(error.message, "error");
          remove.disabled = false;
        }
      });

      row.append(buildMiniCard(product), copy, actions);
      elements.cardList.append(row);
    });
  }

  function renderProductOptions() {
    const owned = new Set((appState.cards || []).map((card) => card.cardProductId));
    const available = (appState.products || []).filter((product) => !owned.has(product.id));
    elements.productSelect.replaceChildren();
    if (!available.length) {
      const option = document.createElement("option");
      option.textContent = "All available products are in your wallet";
      option.value = "";
      elements.productSelect.append(option);
      elements.addButton.disabled = true;
      return;
    }
    available.forEach((product) => {
      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = `${product.name} — ${product.issuer}${product.comparisonStatus === "catalog_only" ? " (catalogued; rewards review pending)" : ""}`;
      elements.productSelect.append(option);
    });
    elements.addButton.disabled = false;
  }

  function renderContext() {
    if (!currentContext) {
      elements.checkoutTitle.textContent = "Open a secure checkout";
      elements.checkoutDetail.textContent = "Click Pip again on an HTTPS checkout page.";
      elements.confidenceChip.hidden = true;
      updateRunState();
      return;
    }
    elements.checkoutTitle.textContent = currentContext.merchant;
    elements.confidenceChip.textContent = `${Math.round(currentContext.confidence * 100)}% category confidence`;
    elements.confidenceChip.hidden = false;
    elements.checkoutDetail.textContent = currentContext.amountDetected
      ? `${formatMoney(currentContext.amountPence, currentContext.currency)} basket · ${currentContext.category} · likely MCC ${currentContext.inferredMcc}`
      : `Checkout found, but Pip could not identify the final total.`;
    updateRunState();
  }

  function renderHistory() {
    elements.activityList.replaceChildren();
    if (!appState.preferences?.cloudHistory) {
      const note = document.createElement("p");
      note.className = "activity-empty";
      note.textContent = "History is off. Recommendations stay out of your account.";
      elements.activityList.append(note);
      return;
    }
    if (!appState.history?.length) {
      const note = document.createElement("p");
      note.className = "activity-empty";
      note.textContent = "No saved decisions yet.";
      elements.activityList.append(note);
      return;
    }
    appState.history.slice(0, 4).forEach((event) => {
      const row = document.createElement("article");
      row.className = "activity-row";
      const copy = document.createElement("span");
      const merchant = document.createElement("strong");
      merchant.textContent = event.merchant;
      const detail = document.createElement("small");
      const date = event.createdAt ? new Date(event.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
      detail.textContent = `${event.cardName} · ${formatMoney(event.amountPence, event.currency)}${date ? ` · ${date}` : ""}`;
      copy.append(merchant, detail);
      const value = document.createElement("b");
      value.textContent = `+${formatMoney(event.estimatedValuePence, event.currency)}`;
      row.append(copy, value);
      elements.activityList.append(row);
    });
  }

  function updateRunState() {
    const enabled = appState?.cards?.some((card) => card.enabled && productById(card.cardProductId)?.comparisonStatus !== "catalog_only");
    elements.runButton.disabled = !activeTabId || !currentContext?.amountDetected || !enabled;
    if (appState && !enabled) elements.runStatus.textContent = "Add or enable a card before comparing.";
    else if (currentContext && !currentContext.amountDetected) elements.runStatus.textContent = "Pip will not guess the total. Make the order total visible, then reopen Pip.";
    else elements.runStatus.textContent = "";
  }

  function renderApp() {
    show("wallet");
    elements.accountEmail.textContent = appState.user?.email || "Pip account";
    elements.historyToggle.checked = Boolean(appState.preferences?.cloudHistory);
    renderContext();
    renderWallet();
    renderProductOptions();
    renderHistory();
  }

  async function prepareTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await call({ type: "PIP_ENSURE_TAB", tabId: tab.id });
      activeTabId = tab.id;
      const response = await chrome.tabs.sendMessage(tab.id, { type: "PIP_GET_CONTEXT" });
      if (response?.ok) currentContext = response.context;
    } catch {
      activeTabId = null;
      currentContext = null;
    }
  }

  async function load() {
    show("loading");
    try {
      const stateResult = await call({ type: "PIP_GET_STATE" });
      appState = stateResult.state;
      if (!appState.signedIn) {
        show("auth");
        return;
      }
      await prepareTab();
      renderApp();
    } catch (error) {
      show("auth");
      elements.authStatus.textContent = error.message;
      elements.authStatus.dataset.tone = "error";
    }
  }

  elements.authMode.addEventListener("click", () => {
    authMode = authMode === "sign-in" ? "sign-up" : "sign-in";
    elements.authSubmit.textContent = authMode === "sign-up" ? "Create account" : "Sign in";
    elements.authMode.textContent = authMode === "sign-up" ? "Already have an account? Sign in" : "New to Pip? Create an account";
    elements.authPassword.autocomplete = authMode === "sign-up" ? "new-password" : "current-password";
    elements.authStatus.textContent = "";
  });

  elements.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.authSubmit.disabled = true;
    elements.authSubmit.textContent = authMode === "sign-up" ? "Creating account…" : "Signing in…";
    elements.authStatus.textContent = "";
    try {
      const result = await call({ type: "PIP_AUTH", mode: authMode, email: elements.authEmail.value, password: elements.authPassword.value });
      if (result.emailConfirmationRequired) {
        elements.authStatus.textContent = "Check your inbox to confirm the account, then sign in.";
        elements.authStatus.dataset.tone = "success";
        authMode = "sign-in";
      } else {
        elements.authPassword.value = "";
        await load();
      }
    } catch (error) {
      elements.authStatus.textContent = error.message;
      elements.authStatus.dataset.tone = "error";
    } finally {
      elements.authSubmit.disabled = false;
      elements.authSubmit.textContent = authMode === "sign-up" ? "Create account" : "Sign in";
    }
  });

  elements.addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.addButton.disabled = true;
    setWalletStatus("Adding card…");
    try {
      const product = productById(elements.productSelect.value);
      const result = await call({
        type: "PIP_ADD_CARD",
        productId: elements.productSelect.value,
        nickname: elements.nickname.value,
        lastFour: elements.lastFour.value
      });
      const stateResult = await call({ type: "PIP_GET_STATE" });
      appState = stateResult.state;
      elements.nickname.value = "";
      elements.lastFour.value = "";
      elements.addPanel.open = false;
      setWalletStatus(result.comparisonReady === false || product?.comparisonStatus === "catalog_only"
        ? "Card added for identification. Its reward terms still need review before Pip can compare it."
        : "Card added.", "success");
      renderWallet();
      renderProductOptions();
      updateRunState();
    } catch (error) {
      setWalletStatus(error.message, "error");
    } finally {
      elements.addButton.disabled = !elements.productSelect.value;
    }
  });

  elements.historyToggle.addEventListener("change", async () => {
    elements.historyToggle.disabled = true;
    const enabled = elements.historyToggle.checked;
    try {
      await call({ type: "PIP_UPDATE_HISTORY", enabled });
      appState.preferences.cloudHistory = enabled;
      renderHistory();
    } catch (error) {
      elements.historyToggle.checked = !enabled;
      setWalletStatus(error.message, "error");
    } finally {
      elements.historyToggle.disabled = false;
    }
  });

  elements.runButton.addEventListener("click", async () => {
    const strong = elements.runButton.querySelector("strong");
    const small = elements.runButton.querySelector("small");
    elements.runButton.disabled = true;
    strong.textContent = "Comparing your wallet…";
    small.textContent = "Using the latest stored rules";
    elements.runStatus.textContent = "Keep this checkout open.";
    try {
      const result = await chrome.tabs.sendMessage(activeTabId, { type: "PIP_RUN" });
      if (!result?.ok) throw new Error(result?.error || "Pip could not compare this checkout.");
      strong.textContent = result.recommendation.isTie
        ? `${result.recommendation.tiedCards.length} cards tie`
        : `${result.recommendation.winner.cardName} wins`;
      small.textContent = `${result.recommendation.winner.valueLabel} estimated value`;
      elements.runStatus.textContent = "The explanation is open on the checkout page.";
      setTimeout(() => window.close(), 650);
    } catch (error) {
      strong.textContent = "Find my best card";
      small.textContent = "Compare current reward rules";
      updateRunState();
      elements.runStatus.textContent = error.message;
      elements.runStatus.dataset.tone = "error";
    }
  });

  elements.signOut.addEventListener("click", async () => {
    await call({ type: "PIP_SIGN_OUT" });
    appState = null;
    show("auth");
    elements.authStatus.textContent = "Signed out. Your session tokens were cleared.";
    elements.authStatus.dataset.tone = "success";
  });

  elements.deleteAccount.addEventListener("click", async () => {
    const confirmed = window.confirm("Delete your Pip account, wallet and saved recommendation history permanently?");
    if (!confirmed) return;
    elements.deleteAccount.disabled = true;
    try {
      await call({ type: "PIP_DELETE_ACCOUNT" });
      appState = null;
      show("auth");
      elements.authStatus.textContent = "Your Pip account and stored data were deleted.";
      elements.authStatus.dataset.tone = "success";
    } catch (error) {
      setWalletStatus(error.message, "error");
      elements.deleteAccount.disabled = false;
    }
  });

  if (!globalThis.chrome?.runtime?.sendMessage) {
    show("auth");
    elements.authStatus.textContent = "Browser preview only · load this folder as an extension to connect.";
  } else {
    void load();
  }
})();

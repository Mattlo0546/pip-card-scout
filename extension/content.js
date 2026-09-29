(function initialisePipContentScript() {
  "use strict";

  if (globalThis.__PIP_EXTENSION_LOADED__) return;
  globalThis.__PIP_EXTENSION_LOADED__ = true;

  const CATEGORY_KEYWORDS = {
    fashion: ["fashion", "apparel", "clothing", "vintage", "garment", "dress", "sneaker", "jeans", "knitwear"],
    groceries: ["grocery", "groceries", "supermarket", "produce", "food shop"],
    dining: ["restaurant", "dining", "takeaway", "delivery", "cafe", "coffee", "pizza"],
    travel: ["flight", "airline", "hotel", "booking", "holiday", "travel"],
    transit: ["rail", "train", "transit", "transport", "rideshare", "taxi", "bus"],
    fuel: ["petrol", "fuel", "gas station", "charging station"],
    subscriptions: ["subscription", "monthly plan", "annual plan", "streaming", "membership", "software"],
    electronics: ["electronics", "laptop", "phone", "computer", "camera", "headphones", "technology"],
    business: ["business", "office", "workspace", "professional service", "saas"]
  };
  const INFERRED_MCC = {
    fashion: "5651", groceries: "5411", dining: "5812", travel: "4722",
    transit: "4111", fuel: "5541", subscriptions: "4899", electronics: "5732",
    business: "7399", online: "5999", general: "5999"
  };

  let ui = null;
  let activationPromise = null;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function parseMoneyValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const raw = String(value || "").trim();
    if (!raw) return null;
    const match = raw.match(/(?:GBP|EUR|USD)?\s*[£€$]?\s*([0-9]+(?:[,.][0-9]{3})*(?:[.,][0-9]{1,2})?)/i);
    if (!match) return null;
    let numberText = match[1];
    const lastComma = numberText.lastIndexOf(",");
    const lastDot = numberText.lastIndexOf(".");
    if (lastComma > lastDot && numberText.length - lastComma <= 3) {
      numberText = numberText.replace(/\./g, "").replace(",", ".");
    } else {
      numberText = numberText.replace(/,/g, "");
    }
    const parsed = Number.parseFloat(numberText);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function detectCurrency(text, explicitCurrency) {
    const currency = String(explicitCurrency || "").trim().toUpperCase();
    if (/^(GBP|EUR|USD)$/.test(currency)) return currency;
    if (/€|\bEUR\b/i.test(text)) return "EUR";
    if (/\$|\bUSD\b/i.test(text)) return "USD";
    return "GBP";
  }

  function findAmount(root) {
    const explicit = parseMoneyValue(root?.getAttribute("data-pip-amount"));
    if (explicit !== null) return { amountPence: Math.round(explicit * 100), detected: true, source: "checkout data" };
    const selectors = [
      "[data-pip-total]", "[data-order-total]", "[data-total]", "[aria-label*='total' i]",
      "[class*='grand-total' i]", "[class*='order-total' i]", "[id*='order-total' i]"
    ];
    for (const selector of selectors) {
      for (const candidate of Array.from(document.querySelectorAll(selector)).slice(0, 20)) {
        const amount = parseMoneyValue(candidate.textContent);
        if (amount !== null) return { amountPence: Math.round(amount * 100), detected: true, source: "order total" };
      }
    }
    const labels = Array.from(document.querySelectorAll("dt, th, strong, b, span")).slice(0, 500);
    for (const label of labels) {
      const value = String(label.textContent || "").trim();
      if (!/^(?:order\s+|grand\s+)?total\b/i.test(value) || value.length > 80) continue;
      const amount = parseMoneyValue(value) ?? parseMoneyValue(label.nextElementSibling?.textContent);
      if (amount !== null) return { amountPence: Math.round(amount * 100), detected: true, source: "total label" };
    }
    return { amountPence: null, detected: false, source: "not found" };
  }

  function normalizeCategory(value) {
    const clean = String(value || "").trim().toLowerCase();
    const aliases = { apparel: "fashion", clothing: "fashion", grocery: "groceries", restaurant: "dining", software: "subscriptions", tech: "electronics" };
    return aliases[clean] || clean;
  }

  function inferCategory(root) {
    const explicit = normalizeCategory(root?.getAttribute("data-pip-category"));
    if (explicit && Object.prototype.hasOwnProperty.call(INFERRED_MCC, explicit)) {
      return { category: explicit, detected: true, explicit: true };
    }
    const description = document.querySelector("meta[name='description']")?.content || "";
    const pageSample = root ? String(root.textContent || "").slice(0, 8000) : String(document.body?.innerText || "").slice(0, 12000);
    const haystack = `${location.hostname} ${document.title} ${description} ${pageSample}`.toLowerCase();
    let best = { category: "online", score: 0 };
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = keywords.reduce((total, keyword) => total + Number(haystack.includes(keyword)), 0);
      if (score > best.score) best = { category, score };
    }
    return { category: best.category, detected: best.score > 0, explicit: false, score: best.score };
  }

  function humanizeHost() {
    return (location.hostname.replace(/^www\./, "").split(".")[0] || "This shop")
      .split(/[-_]/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }

  function detectCheckoutContext() {
    const root = document.querySelector("[data-pip-checkout]");
    const amount = findAmount(root);
    const category = inferCategory(root);
    const sample = String(root?.textContent || document.title || "").slice(0, 5000);
    const merchant = root?.getAttribute("data-pip-merchant") ||
      document.querySelector("meta[property='og:site_name']")?.content || humanizeHost();
    const currency = detectCurrency(sample, root?.getAttribute("data-pip-currency"));
    return {
      merchant: merchant.trim().slice(0, 120) || "This shop",
      category: category.category,
      categoryDetected: category.detected,
      inferredMcc: INFERRED_MCC[category.category] || INFERRED_MCC.general,
      confidence: category.explicit ? 0.98 : category.score >= 3 ? 0.84 : category.score === 2 ? 0.72 : category.detected ? 0.58 : 0.42,
      amountPence: amount.amountPence,
      amountDetected: amount.detected,
      amountSource: amount.source,
      currency,
      looksLikeCheckout: Boolean(root) || /checkout|payment|billing/i.test(`${location.pathname} ${document.title}`)
    };
  }

  function formatMoney(pence, currency) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(pence || 0) / 100);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function buildBotMarkup() {
    return `<div class="pip-bot-shadow"></div><div class="pip-bot-antenna"><i></i></div><div class="pip-bot-head"><span class="pip-bot-eye pip-bot-eye-left"></span><span class="pip-bot-eye pip-bot-eye-right"></span><span class="pip-bot-mouth"></span></div><div class="pip-bot-feet"><i></i><i></i></div><span class="pip-bot-badge">p</span>`;
  }

  function ensureUi() {
    if (ui?.host?.isConnected) return ui;
    const host = document.createElement("div");
    host.id = "pip-extension-root";
    const shadow = host.attachShadow({ mode: "closed" });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("content.css");
    const layer = document.createElement("div");
    layer.id = "pip-extension-layer";
    layer.innerHTML = `
      <div class="pip-flight" aria-hidden="true"><div class="pip-thought">checking the tiny print…</div><div class="pip-bot">${buildBotMarkup()}</div></div>
      <div class="pip-scan" aria-hidden="true"><i></i><i></i><i></i></div>
      <aside class="pip-panel" role="dialog" aria-modal="false" aria-labelledby="pip-panel-title">
        <header class="pip-panel-header"><div class="pip-mini-mark" aria-hidden="true">p</div><div><p class="pip-eyebrow">PIP · CHECKOUT DECISION</p><h2 id="pip-panel-title">Best card, found.</h2></div><button class="pip-close" type="button" aria-label="Close Pip">×</button></header>
        <div class="pip-panel-body"></div>
      </aside>`;
    shadow.append(stylesheet, layer);
    if ("adoptedStyleSheets" in shadow && typeof CSSStyleSheet === "function") {
      fetch(stylesheet.href)
        .then((response) => response.text())
        .then((css) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          shadow.adoptedStyleSheets = [sheet];
          stylesheet.remove();
        })
        .catch(() => {
          // The linked extension stylesheet remains as the compatible fallback.
        });
    }
    document.documentElement.appendChild(host);
    const panel = layer.querySelector(".pip-panel");
    const flight = layer.querySelector(".pip-flight");
    const scan = layer.querySelector(".pip-scan");
    layer.querySelector(".pip-close").addEventListener("click", () => {
      panel.classList.remove("pip-panel-visible");
      flight.classList.remove("pip-flight-visible");
      scan.classList.remove("pip-scan-visible");
    });
    ui = {
      host, layer, panel, flight, scan,
      bot: layer.querySelector(".pip-bot"),
      thought: layer.querySelector(".pip-thought"),
      body: layer.querySelector(".pip-panel-body")
    };
    return ui;
  }

  function targetElement() {
    return document.querySelector("[data-pip-payment], [data-pip-card-slot], [data-pip-checkout], form[action*='checkout' i], form") || document.body;
  }

  async function animateRecommendation(recommendation, showBot) {
    if (!showBot) return;
    const current = ensureUi();
    const rect = targetElement().getBoundingClientRect();
    const x = Math.max(18, Math.min(innerWidth - 94, rect.left + Math.min(rect.width * 0.72, 280)));
    const y = Math.max(32, Math.min(innerHeight - 110, rect.top + Math.min(rect.height * 0.32, 150)));
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    current.flight.classList.add("pip-flight-visible");
    current.panel.classList.remove("pip-panel-visible");
    current.bot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    current.thought.style.left = `${Math.max(10, x - 72)}px`;
    current.thought.style.top = `${Math.max(8, y - 50)}px`;
    if (!reduced && current.bot.animate) {
      await current.bot.animate([
        { transform: `translate3d(${innerWidth + 100}px, ${y + 70}px, 0) rotate(8deg)` },
        { transform: `translate3d(${x}px, ${y}px, 0) rotate(0deg)` }
      ], { duration: 900, easing: "cubic-bezier(.22,.82,.3,1)", fill: "both" }).finished.catch(() => {});
    }
    current.scan.style.left = `${Math.max(8, rect.left - 8)}px`;
    current.scan.style.top = `${Math.max(8, rect.top - 8)}px`;
    current.scan.style.width = `${Math.min(innerWidth - Math.max(8, rect.left) - 8, Math.max(180, rect.width + 16))}px`;
    current.scan.style.height = `${Math.min(innerHeight - Math.max(8, rect.top) - 8, Math.max(110, rect.height + 16))}px`;
    current.scan.classList.add("pip-scan-visible");
    for (const [index, result] of recommendation.comparison.slice(0, 3).entries()) {
      current.thought.textContent = `${index + 1}/${Math.min(3, recommendation.comparison.length)} · ${result.cardName} · ${result.valueLabel}`;
      await sleep(reduced ? 30 : 420);
    }
    current.scan.classList.remove("pip-scan-visible");
    current.thought.textContent = recommendation.isTie ? "the top value is tied" : "this one earns the most";
    await sleep(reduced ? 30 : 350);
  }

  function renderError(message) {
    const current = ensureUi();
    current.body.replaceChildren(
      createElement("p", "pip-empty", message),
      createElement("p", "pip-legal", "Open Pip from the toolbar to review your wallet or try again.")
    );
    current.panel.classList.add("pip-panel-visible");
    current.flight.classList.remove("pip-flight-visible");
  }

  function renderResult(recommendation) {
    const current = ensureUi();
    const { winner, runnerUp } = recommendation;
    current.layer.querySelector("#pip-panel-title").textContent = recommendation.isTie ? "Top value: a tie." : "Best card, found.";
    current.body.replaceChildren();
    const contextLine = createElement("div", "pip-context-line");
    contextLine.append(
      createElement("span", "pip-merchant", recommendation.merchant),
      createElement("span", "pip-basket", `${formatMoney(recommendation.amountPence, recommendation.currency)} · ${recommendation.category}`)
    );
    const winnerWrap = createElement("div", "pip-winner-wrap");
    const cardFace = createElement("div", "pip-card-face");
    cardFace.style.setProperty("--pip-card-a", winner.artwork[0]);
    cardFace.style.setProperty("--pip-card-b", winner.artwork[1]);
    cardFace.style.setProperty("--pip-card-accent", winner.artwork[2]);
    const faceTop = createElement("div", "pip-card-top");
    faceTop.append(createElement("span", "pip-card-name", winner.cardName), createElement("span", "pip-card-wallet-label", "YOUR WALLET"));
    const faceBottom = createElement("div", "pip-card-bottom");
    faceBottom.append(createElement("span", "pip-card-digits", winner.issuer), createElement("span", "pip-card-network", winner.network));
    cardFace.append(faceTop, faceBottom);
    const valueBox = createElement("div", "pip-value-box");
    valueBox.append(createElement("span", "pip-value-kicker", winner.offerValuePence ? "VALUE + OFFER" : "ESTIMATED VALUE"), createElement("strong", "pip-value", winner.valueLabel), createElement("span", "pip-reward-label", winner.rewardLabel));
    winnerWrap.append(cardFace, valueBox);

    const why = createElement("section", "pip-why");
    why.append(createElement("h3", "pip-section-title", "Why this card"));
    const logic = createElement("div", "pip-logic");
    const inference = createElement("div", "pip-logic-row");
    inference.append(createElement("span", "pip-logic-icon", "01"), createElement("p", "", `${recommendation.category} · likely MCC ${recommendation.inferredMcc || "unknown"} · ${Math.round(recommendation.confidence * 100)}% confidence`));
    const rule = createElement("div", "pip-logic-row");
    rule.append(createElement("span", "pip-logic-icon", "02"), createElement("p", "", `${winner.earnLabel} → ${formatMoney(winner.categoryValuePence, recommendation.currency)}`));
    logic.append(inference, rule);
    if (winner.offerValuePence) {
      const offer = createElement("div", "pip-logic-row pip-offer-row");
      offer.append(createElement("span", "pip-logic-icon", "03"), createElement("p", "", `${winner.appliedOffers.map((item) => item.label).join(" + ")} → +${formatMoney(winner.offerValuePence, recommendation.currency)}`));
      logic.append(offer);
    }
    if (runnerUp) {
      const compare = createElement("div", "pip-logic-row");
      compare.append(createElement("span", "pip-logic-icon", winner.offerValuePence ? "04" : "03"), createElement("p", "", recommendation.valueDeltaPence > 0 ? `${formatMoney(recommendation.valueDeltaPence, recommendation.currency)} more than ${runnerUp.cardName}` : `Tied on estimated value with ${recommendation.tiedCards.slice(1).join(", ")}`));
      logic.append(compare);
    }
    why.append(logic);

    const audit = document.createElement("details");
    audit.className = "pip-audit";
    const summary = createElement("summary", "", "Rules and caveats");
    const auditBody = createElement("div", "pip-audit-body");
    auditBody.append(createElement("p", "", winner.sourceLabel), createElement("p", "", `Redeem through ${winner.redemptionLabel.toLowerCase()}.`));
    recommendation.caveats.forEach((caveat) => auditBody.append(createElement("p", "", caveat)));
    audit.append(summary, auditBody);

    const compare = createElement("section", "pip-compare");
    compare.append(createElement("h3", "pip-section-title", "Top of your wallet"));
    const maxValue = Math.max(1, winner.valuePence);
    recommendation.comparison.forEach((result, index) => {
      const row = createElement("div", `pip-compare-row${index === 0 ? " pip-compare-row-best" : ""}`);
      const main = createElement("div", "pip-compare-main");
      const labels = createElement("div", "pip-compare-labels");
      labels.append(createElement("span", "", result.cardName), createElement("strong", "", result.valueLabel));
      const track = createElement("span", "pip-track");
      const fill = createElement("i", "pip-track-fill");
      fill.style.width = `${Math.max(8, (result.valuePence / maxValue) * 100)}%`;
      track.append(fill);
      main.append(labels, track);
      row.append(createElement("span", "pip-rank", index === 0 ? "✓" : String(index + 1)), main);
      compare.append(row);
    });

    const status = createElement("div", "pip-fill-status");
    const statusCopy = createElement("div", "");
    statusCopy.append(
      createElement("strong", "", recommendation.isTie ? `Choose any tied card in Chrome Autofill` : `Choose ${winner.cardName} in Chrome Autofill`),
      createElement("span", "", recommendation.isTie ? recommendation.tiedCards.join(" · ") : "Pip never reads or fills your card number, expiry or CVC.")
    );
    status.append(createElement("span", "pip-status-icon", "✓"), statusCopy);
    const legal = createElement("p", "pip-legal", "Estimated rewards, not financial advice. Your issuer's posted terms and final merchant classification control.");
    current.body.append(contextLine, winnerWrap, why, audit, compare, status, legal);
    current.panel.classList.add("pip-panel-visible");
    current.flight.classList.remove("pip-flight-visible");
  }

  async function runActivation() {
    const context = detectCheckoutContext();
    if (!context.amountDetected || !context.amountPence) {
      renderError("Pip could not find a checkout total. Review the page, then try again.");
      return { ok: false, error: "CHECKOUT_TOTAL_NOT_FOUND", context };
    }
    const [result, settingsResult] = await Promise.all([
      chrome.runtime.sendMessage({ type: "PIP_RECOMMEND", context }),
      chrome.runtime.sendMessage({ type: "PIP_GET_SETTINGS" })
    ]);
    if (!result?.ok) {
      renderError(result?.error || "Pip could not compare this checkout.");
      return result || { ok: false };
    }
    await animateRecommendation(result.recommendation, settingsResult?.settings?.showBot !== false);
    renderResult(result.recommendation);
    return { ok: true, context, recommendation: result.recommendation };
  }

  function activate() {
    if (activationPromise) return activationPromise;
    activationPromise = runActivation().finally(() => { activationPromise = null; });
    return activationPromise;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PIP_GET_CONTEXT") {
      sendResponse({ ok: true, context: detectCheckoutContext() });
      return false;
    }
    if (message?.type === "PIP_RUN") {
      activate().then(sendResponse).catch((error) => {
        const messageText = error instanceof Error ? error.message : "Pip could not run on this checkout.";
        renderError(messageText);
        sendResponse({ ok: false, error: messageText });
      });
      return true;
    }
    return false;
  });
})();

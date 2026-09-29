import { bearerToken, json, messageFromUnknown, options, readObject } from "@/lib/api";
import { DataError, loadCatalog, loadOffers, loadRules, loadWallet } from "@/lib/pip-data";
import { formatMoney, rankWallet, type CheckoutContext } from "@/lib/rewards-engine";
import { adminRestRequest, getAuthUser, parseSupabaseResponse, restRequest } from "@/lib/supabase-rest";

export function OPTIONS() {
  return options();
}

function checkoutContext(body: Record<string, unknown>): CheckoutContext | null {
  const merchant = typeof body.merchant === "string" ? body.merchant.trim().slice(0, 120) : "";
  const category = typeof body.category === "string" ? body.category.trim().slice(0, 40) : "";
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  const amountPence = Math.round(Number(body.amountPence));
  const confidence = Number(body.confidence);
  if (!merchant || !category || !/^[A-Z]{3}$/.test(currency)) return null;
  if (!Number.isSafeInteger(amountPence) || amountPence < 1 || amountPence > 100_000_000) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;

  return {
    merchant,
    category,
    currency,
    amountPence,
    confidence,
    inferredMcc: typeof body.inferredMcc === "string" ? body.inferredMcc.slice(0, 8) : null,
    url: typeof body.url === "string" ? body.url.slice(0, 300) : null,
    amountDetected: body.amountDetected !== false,
  };
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  const user = token ? await getAuthUser(token) : null;
  if (!token || !user) return json({ error: "Sign in before asking Pip to compare your wallet." }, { status: 401 });
  const body = await readObject(request);
  const context = body ? checkoutContext(body) : null;
  if (!context) return json({ error: "The checkout context is incomplete or invalid." }, { status: 400 });

  try {
    const [wallet, catalog] = await Promise.all([loadWallet(token, user.id), loadCatalog(token)]);
    const enabledWallet = wallet.filter((card) => card.enabled);
    if (!enabledWallet.length) return json({ error: "Enable at least one card in your Pip wallet." }, { status: 422 });
    const productIds = [...new Set(enabledWallet.map((card) => card.cardProductId))];
    const [rules, offers] = await Promise.all([loadRules(token, productIds), loadOffers(token, productIds)]);
    const products = catalog.filter((product) => productIds.includes(product.id));
    const ranking = rankWallet({ wallet: enabledWallet, products, rules, offers, context });
    const winningCard = ranking[0];
    if (!winningCard) return json({ error: "No active reward product matches the cards in your wallet and checkout currency." }, { status: 422 });
    const runnerUpCard = ranking[1] ?? null;
    const valueDeltaPence = runnerUpCard ? Math.max(0, winningCard.valuePence - runnerUpCard.valuePence) : null;
    const isTie = Boolean(runnerUpCard && runnerUpCard.valuePence === winningCard.valuePence);
    const caveats = [
      "The merchant category is inferred before authorization; your issuer may classify it differently.",
      `Confirm that ${winningCard.network} is accepted before paying.`,
      ...(context.amountDetected ? [] : ["The checkout total was not detected, so this result uses an estimate."]),
      ...(winningCard.rewardCapPence === null ? [] : ["The estimate assumes enough room remains under this reward cap."]),
      ...(context.currency === "GBP" ? [] : ["No foreign-exchange fee or currency conversion has been included."]),
    ];

    const present = (item: typeof winningCard) => ({
      cardName: item.cardName,
      issuer: item.issuer,
      network: item.network,
      artwork: item.artwork,
      valuePence: item.valuePence,
      categoryValuePence: item.categoryValuePence,
      offerValuePence: item.offerValuePence,
      valueLabel: item.valueLabel,
      rewardLabel: item.rewardLabel,
      earnLabel: item.earnLabel,
      reason: item.reason,
      sourceLabel: item.sourceLabel,
      redemptionLabel: item.redemptionLabel,
      rewardCapPence: item.rewardCapPence,
      matchedCategoryRule: item.matchedCategoryRule,
      appliedOffers: item.appliedOffers.map(({ label, valuePence }) => ({ label, valuePence })),
    });

    const winner = present(winningCard);
    const runnerUp = runnerUpCard ? present(runnerUpCard) : null;
    const recommendation = {
      merchant: context.merchant,
      category: context.category,
      amountPence: context.amountPence,
      currency: context.currency,
      inferredMcc: context.inferredMcc,
      confidence: context.confidence,
      amountDetected: context.amountDetected,
      winner,
      runnerUp,
      isTie,
      tiedCards: isTie
        ? ranking.filter((item) => item.valuePence === winningCard.valuePence).map((item) => item.cardName)
        : [],
      valueDeltaPence,
      comparison: ranking.slice(0, 3).map(present),
      caveats,
    };

    let decisionId: string | null = null;
    let logWarning: string | null = null;
    const settingsResponse = await restRequest(
      `user_settings?select=cloud_history&user_id=eq.${user.id}&limit=1`,
      { token },
    );
    const settingsPayload = await parseSupabaseResponse(settingsResponse);
    const cloudHistory = settingsResponse.ok && Array.isArray(settingsPayload)
      ? Boolean((settingsPayload[0] as Record<string, unknown> | undefined)?.cloud_history)
      : false;

    if (cloudHistory) {
      try {
        const logResponse = await adminRestRequest("recommendation_events", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: {
            user_id: user.id,
            merchant: context.merchant,
            site_url: context.url,
            category: context.category,
            inferred_mcc: context.inferredMcc,
            confidence: context.confidence,
            amount_pence: context.amountPence,
            currency: context.currency,
            amount_detected: context.amountDetected,
            chosen_wallet_card_id: winningCard.walletCardId,
            estimated_value_pence: winningCard.valuePence,
            runner_up_value_pence: runnerUpCard?.valuePence ?? null,
            explanation: recommendation,
            rules_version: winningCard.sourceLabel,
          },
        });
        const logPayload = await parseSupabaseResponse(logResponse);
        if (logResponse.ok && Array.isArray(logPayload) && logPayload[0] && typeof logPayload[0] === "object") {
          const rawId = (logPayload[0] as Record<string, unknown>).id;
          decisionId = typeof rawId === "string" ? rawId : null;
        } else {
          logWarning = messageFromUnknown(logPayload, "The recommendation could not be added to your history.");
        }
      } catch (error) {
        logWarning = error instanceof Error ? error.message : "The recommendation could not be added to your history.";
      }
    }

    return json({
      recommendation,
      decision: { id: decisionId, logged: Boolean(decisionId), historyEnabled: cloudHistory },
      summary: isTie
        ? `${winningCard.cardName} and ${runnerUpCard?.cardName} tie at about ${formatMoney(winningCard.valuePence, context.currency)} on this checkout.`
        : `${winningCard.cardName} is worth about ${formatMoney(winningCard.valuePence, context.currency)} on this checkout.`,
      ...(logWarning ? { warning: logWarning } : {}),
    });
  } catch (error) {
    const status = error instanceof DataError ? error.status : 503;
    return json({ error: error instanceof Error ? error.message : "Pip could not compare your wallet." }, { status });
  }
}

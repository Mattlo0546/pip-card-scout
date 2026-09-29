import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWED_AT = "2026-09-28";

const files = {
  banks: "research/uk-card-catalog/banks.json",
  rewards: "research/uk-card-catalog/rewards.json",
  other: "research/uk-card-catalog/other.json",
};

const raw = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [
  key,
  JSON.parse(await readFile(resolve(ROOT, path), "utf8")),
])));

const catalogOnlyOverrides = new Set([
  "amazon-barclaycard",
  "amex-uk-cashback-everyday",
  "amex-uk-cashback",
  "hsbc-rewards-credit-card",
  "john-lewis-partnership-credit-card",
  "lloyds-ultra-credit-card",
  "ms-bank-rewards",
  "natwest-reward-black-credit-card",
  "natwest-travel-reward-credit-card",
  "pulse-mastercard",
  "rbs-reward-black-credit-card",
  "rbs-reward-credit-card",
  "santander-all-in-one-credit-card",
  "santander-rewards-credit-card",
  "santander-world-elite-mastercard",
  "tesco-bank-all-round",
  "tesco-bank-balance-transfer-and-purchases",
  "tesco-bank-everyday-low-apr",
  "tesco-bank-foundation",
  "virgin-money-uk-everyday-cashback",
  "yonder-premium-credit",
]);

const annualFeeOverrides = new Map([
  ["yonder-premium-credit", 19_000],
]);

const noteOverrides = new Map([
  ["amex-uk-rewards-credit-card", "The base value uses American Express's official 1,000-points-to-£4.50 statement-credit option (0.45p per point). Other redemption methods can be worth more or less."],
]);

const extraSources = new Map([
  ["amex-uk-rewards-credit-card", ["https://www.americanexpress.com/en-gb/benefits/rewards/membership-rewards/"]],
]);

const rewardConfig = {
  "barclaycard-rewards": cashback(0.25, "Cashback credited under the issuer reward rules"),
  "amazon-barclaycard": cashback(0.25, "Amazon rewards redeemed in £5 Amazon Gift Card increments"),
  "lloyds-ultra-credit-card": cashback(0.25, "Cashback credited to the card account"),
  "halifax-cashback-credit-card": cashback(0.25, "Cashback credited to the card account"),
  "natwest-reward-black-credit-card": cashback(0.5, "Cash-equivalent NatWest Rewards", [
    rule(["groceries"], "cashback", 1, "1% in Rewards at supermarkets"),
  ]),
  "natwest-travel-reward-credit-card": cashback(0.1, "Cash-equivalent NatWest Rewards", [
    rule(["travel", "transit"], "cashback", 1, "1% in Rewards on eligible travel spending"),
  ]),
  "rbs-reward-credit-card": cashback(0.25, "Cash-equivalent Royal Bank Rewards", [
    rule(["groceries"], "cashback", 1, "1% in Rewards at supermarkets"),
  ]),
  "rbs-reward-black-credit-card": cashback(0.5, "Cash-equivalent Royal Bank Rewards", [
    rule(["groceries"], "cashback", 1, "1% in Rewards at supermarkets"),
  ]),
  "santander-rewards-credit-card": cashback(0.25, "Cashback credited to the card account"),

  "amex-uk-rewards-credit-card": points(1, 0.45, "Membership Rewards statement-credit floor"),
  "amex-uk-nectar": points(2, 0.5, "Nectar points at the issuer-stated minimum redemption value"),
  "tesco-bank-balance-transfer-and-purchases": points(0.125, 1, "Clubcard vouchers"),
  "tesco-bank-all-round": points(0.125, 1, "Clubcard vouchers"),
  "tesco-bank-everyday-low-apr": points(0.125, 1, "Clubcard vouchers"),
  "tesco-bank-foundation": points(0.125, 1, "Clubcard vouchers"),
  "ms-bank-rewards": points(0.2, 1, "M&S vouchers"),
  "ms-bank-purchase-plus": points(0.2, 1, "M&S vouchers"),
  "ms-bank-transfer-plus": points(0.2, 1, "M&S vouchers"),
  "john-lewis-partnership-credit-card": points(0.1, 1, "John Lewis and Waitrose vouchers"),

  "yonder-premium-credit": points(5, 0.1, "Yonder Premium account-credit floor"),
};

function cashback(rate, redemptionLabel, rules = []) {
  return { type: "cashback", rate, pointValuePence: null, redemptionLabel, rules };
}

function points(rate, pointValuePence, redemptionLabel, rules = []) {
  return { type: "points", rate, pointValuePence, redemptionLabel, rules };
}

function rule(categories, type, rate, label, pointValuePence = null) {
  return { categories, type, rate, pointValuePence, capPence: null, label, priority: 100, requiresActivation: false };
}

function moneyToPence(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
}

function rewardEntries(group, product) {
  if (group === "rewards") return product.ongoing_rewards ?? [];
  return product.ongoing_purchase_rewards ?? [];
}

function promotions(group, product) {
  if (group === "banks") return product.introductory_promos ?? [];
  return product.introductory_promotions ?? [];
}

function normalize(group, product) {
  const name = product.product_name ?? product.name;
  const productUrl = product.product_url;
  const termsUrl = group === "banks"
    ? product.terms_summary_url
    : group === "rewards"
      ? product.official_terms_or_summary_url
      : product.terms_url;
  const researchedFeePence = group === "other"
    ? moneyToPence(product.annual_fee?.amount_gbp)
    : moneyToPence(product.annual_fee_gbp);
  const feePence = annualFeeOverrides.get(product.id) ?? researchedFeePence;
  const researchedStatus = product.publishability === "rankable" ? "verified" : "catalog_only";
  const entries = rewardEntries(group, product);
  const configuredReward = rewardConfig[product.id];
  const comparisonStatus = catalogOnlyOverrides.has(product.id) || !configuredReward
    ? "catalog_only"
    : researchedStatus;

  if (comparisonStatus === "verified" && entries.length > 0 && !configuredReward) {
    throw new Error(`Verified reward product ${product.id} needs an explicit engine mapping.`);
  }

  const engineReward = comparisonStatus === "verified"
    ? configuredReward ?? cashback(0, "No ongoing purchase rewards")
    : cashback(0, "Catalogued for identification; reward comparison pending");
  const ambiguity = Array.isArray(product.ambiguities) ? product.ambiguities : [];
  const promoCount = promotions(group, product).length;
  const notes = [
    noteOverrides.get(product.id) ?? product.publishability_reason,
    ...ambiguity,
    promoCount ? `${promoCount} introductory or account-specific promotion${promoCount === 1 ? " was" : "s were"} recorded in research but excluded from ongoing checkout ranking.` : null,
    product.fx_fee_percent_on_purchases != null ? `Published foreign-purchase fee: ${product.fx_fee_percent_on_purchases}%. FX costs are not yet included in ranking.` : null,
    product.foreign_transaction_fee_percent != null ? `Published foreign-purchase fee: ${product.foreign_transaction_fee_percent}%. FX costs are not yet included in ranking.` : null,
    product.fx_fee?.percent != null ? `Published foreign-purchase fee: ${product.fx_fee.percent}%. FX costs are not yet included in ranking.` : null,
  ].filter(Boolean).join(" ");
  const sourceUrls = [...new Set([
    productUrl,
    termsUrl,
    ...(product.sources ?? []),
    product.fixed_redemption_value?.source_url,
    product.official_fixed_redemption_value?.source_url,
    ...(extraSources.get(product.id) ?? []),
  ].filter(Boolean))];

  return {
    slug: product.id,
    name,
    issuer: product.issuer,
    network: product.network ?? "Not stated",
    annualFeePence: feePence,
    comparisonStatus,
    baseReward: {
      type: engineReward.type,
      rate: engineReward.rate,
      pointValuePence: engineReward.pointValuePence,
      redemptionLabel: engineReward.redemptionLabel,
    },
    sourceUrl: productUrl,
    termsUrl: termsUrl ?? productUrl,
    sourceUrls,
    sourceCheckedAt: REVIEWED_AT,
    notes: notes || "Current product identity and ongoing terms checked against official issuer material.",
    rules: engineReward.rules,
  };
}

const products = [];
const seen = new Set();
for (const group of ["banks", "rewards", "other"]) {
  for (const product of raw[group].products) {
    if (product.publishability === "exclude") continue;
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    products.push(normalize(group, product));
  }
}

products.sort((a, b) => a.issuer.localeCompare(b.issuer, "en-GB") || a.name.localeCompare(b.name, "en-GB"));

const output = {
  schemaVersion: 1,
  market: "GB",
  currency: "GBP",
  release: {
    version: "uk-2026.09.28",
    reviewedAt: REVIEWED_AT,
    sourcePolicy: "Official issuer, card-programme, or merchant programme sources only. Introductory offers are excluded from the base rate. A product is catalog-only when its ongoing value needs account-age, cumulative-spend, cap-usage, activation, or variable redemption state that Pip does not yet track.",
  },
  products,
};

const outputPath = resolve(ROOT, "catalog/uk-credit-cards.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${products.length} products to ${outputPath}`);

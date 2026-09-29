import assert from "node:assert/strict";
import test from "node:test";

import { rankWallet } from "../lib/rewards-engine.ts";

const products = [
  {
    id: "cash-plus",
    name: "Cash Plus",
    issuer: "Test Issuer A",
    network: "VISA",
    billingCurrency: "GBP",
    baseRewardType: "cashback",
    baseRewardRate: 1,
    pointValuePence: null,
    annualFeePence: 0,
    redemptionLabel: "Statement credit",
    termsVersion: "Test fixture 2026.09",
    termsUrl: null,
    comparisonStatus: "verified",
    sourceCheckedAt: "2026-09-01T00:00:00Z",
    dataNotes: null,
    artworkFrom: "#173f3a",
    artworkTo: "#2f7467",
    artworkAccent: "#c8ff62",
  },
  {
    id: "online-rewards",
    name: "Online Rewards",
    issuer: "Test Issuer B",
    network: "MASTERCARD",
    billingCurrency: "GBP",
    baseRewardType: "cashback",
    baseRewardRate: 0.75,
    pointValuePence: null,
    annualFeePence: 0,
    redemptionLabel: "Statement credit",
    termsVersion: "Test fixture 2026.09",
    termsUrl: null,
    comparisonStatus: "verified",
    sourceCheckedAt: "2026-09-01T00:00:00Z",
    dataNotes: null,
    artworkFrom: "#512c2a",
    artworkTo: "#c55c42",
    artworkAccent: "#ffd0a6",
  },
  {
    id: "everyday-cashback",
    name: "Everyday Cashback",
    issuer: "Test Issuer C",
    network: "VISA",
    billingCurrency: "GBP",
    baseRewardType: "cashback",
    baseRewardRate: 2,
    pointValuePence: null,
    annualFeePence: 0,
    redemptionLabel: "Automatic statement credit",
    termsVersion: "Test fixture 2026.09",
    termsUrl: null,
    comparisonStatus: "verified",
    sourceCheckedAt: "2026-09-01T00:00:00Z",
    dataNotes: null,
    artworkFrom: "#134853",
    artworkTo: "#318596",
    artworkAccent: "#baf2de",
  },
];

const wallet = products.map((product, index) => ({
  id: `wallet-${index}`,
  cardProductId: product.id,
  nickname: null,
  lastFour: null,
  enabled: true,
  activatedCategories: [],
}));

const rules = [
  {
    id: "fashion-8",
    cardProductId: "cash-plus",
    categories: ["fashion"],
    rewardType: "cashback",
    rate: 8,
    pointValuePence: null,
    rewardCapPence: 2000,
    label: "8% back on fashion",
    priority: 100,
    requiresActivation: false,
  },
  {
    id: "online-4",
    cardProductId: "online-rewards",
    categories: ["fashion", "online"],
    rewardType: "cashback",
    rate: 4,
    pointValuePence: null,
    rewardCapPence: null,
    label: "4% back online",
    priority: 100,
    requiresActivation: false,
  },
];

const offers = [{
  id: "example-shop-4",
  cardProductId: "cash-plus",
  merchantPattern: "example shop",
  minSpendPence: 7500,
  bonusPence: 400,
  currency: "GBP",
  label: "£4 Example Shop offer",
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2030-01-01T00:00:00Z",
}];

function context(overrides = {}) {
  return {
    merchant: "Example Shop",
    category: "fashion",
    amountPence: 8640,
    currency: "GBP",
    inferredMcc: "5651",
    confidence: 0.92,
    url: "https://checkout.example",
    amountDetected: true,
    ...overrides,
  };
}

test("Cash Plus wins the example basket by £7.45", () => {
  const [winner, runnerUp] = rankWallet({ wallet, products, rules, offers, context: context(), now: new Date("2026-09-27") });
  assert.equal(winner.cardName, "Cash Plus");
  assert.equal(winner.categoryValuePence, 691);
  assert.equal(winner.offerValuePence, 400);
  assert.equal(winner.valuePence, 1091);
  assert.equal(runnerUp.cardName, "Online Rewards");
  assert.equal(runnerUp.valuePence, 346);
  assert.equal(winner.valuePence - runnerUp.valuePence, 745);
});

test("the merchant offer respects its threshold", () => {
  const [winner] = rankWallet({ wallet, products, rules, offers, context: context({ amountPence: 7400 }), now: new Date("2026-09-27") });
  assert.equal(winner.cardName, "Cash Plus");
  assert.equal(winner.offerValuePence, 0);
  assert.equal(winner.valuePence, 592);
});

test("low category confidence uses base rates instead of category bonuses", () => {
  const [winner] = rankWallet({
    wallet,
    products,
    rules,
    offers,
    context: context({ merchant: "Unknown shop", confidence: 0.42 }),
    now: new Date("2026-09-27"),
  });
  assert.equal(winner.cardName, "Everyday Cashback");
  assert.equal(winner.valuePence, 173);
});

test("cards with a different billing currency are not ranked", () => {
  const ranking = rankWallet({ wallet, products, rules, offers, context: context({ currency: "USD" }), now: new Date("2026-09-27") });
  assert.deepEqual(ranking, []);
});

test("catalog-only products are never ranked", () => {
  const catalogOnlyProducts = products.map((product) => ({
    ...product,
    comparisonStatus: product.id === "everyday-cashback" ? "catalog_only" : "verified",
  }));
  const [winner] = rankWallet({
    wallet,
    products: catalogOnlyProducts,
    rules: [],
    offers: [],
    context: context({ merchant: "Unknown shop", confidence: 0.42 }),
    now: new Date("2026-09-27"),
  });
  assert.equal(winner.cardName, "Cash Plus");
});

test("disabled wallet cards are ignored", () => {
  const disabledWallet = wallet.map((card) => ({ ...card, enabled: card.cardProductId === "everyday-cashback" }));
  const [winner] = rankWallet({ wallet: disabledWallet, products, rules, offers, context: context(), now: new Date("2026-09-27") });
  assert.equal(winner.cardName, "Everyday Cashback");
});

test("expired rules and offers are excluded", () => {
  const expiredRules = rules.map((rule) => ({ ...rule, validTo: "2025-12-31T23:59:59Z" }));
  const [winner] = rankWallet({
    wallet,
    products,
    rules: expiredRules,
    offers,
    context: context({ merchant: "Unknown shop" }),
    now: new Date("2026-09-27"),
  });
  assert.equal(winner.cardName, "Everyday Cashback");
  assert.equal(winner.valuePence, 173);

  const [postOfferWinner] = rankWallet({
    wallet,
    products,
    rules,
    offers,
    context: context(),
    now: new Date("2031-01-01"),
  });
  assert.equal(postOfferWinner.cardName, "Cash Plus");
  assert.equal(postOfferWinner.offerValuePence, 0);
  assert.equal(postOfferWinner.valuePence, 691);
});

test("merchant offers never cross currencies", () => {
  const usdOffer = [{ ...offers[0], currency: "USD" }];
  const [winner] = rankWallet({ wallet, products, rules, offers: usdOffer, context: context(), now: new Date("2026-09-27") });
  assert.equal(winner.cardName, "Cash Plus");
  assert.equal(winner.offerValuePence, 0);
});

test("merchant offer matching uses merchant-name boundaries", () => {
  const [winner] = rankWallet({
    wallet,
    products,
    rules,
    offers,
    context: context({ merchant: "Notexample shop" }),
    now: new Date("2026-09-27"),
  });
  assert.equal(winner.cardName, "Cash Plus");
  assert.equal(winner.offerValuePence, 0);
});

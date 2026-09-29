import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(await readFile(new URL("../catalog/uk-credit-cards.json", import.meta.url), "utf8"));
const products = catalog.products;

test("the UK release contains at least fifty unique current products", () => {
  assert.ok(products.length >= 50);
  assert.equal(new Set(products.map((product) => product.slug)).size, products.length);
  assert.equal(products.some((product) => product.slug === "amazon-newday-legacy"), false);
  assert.equal(products.some((product) => product.slug === "argos-pay"), false);
  assert.equal(products.some((product) => product.slug === "currensea-direct-debit-travel-card"), false);
});

test("every product is dated and linked to official HTTPS evidence", () => {
  for (const product of products) {
    assert.equal(product.sourceCheckedAt, catalog.release.reviewedAt);
    assert.match(product.sourceUrl, /^https:\/\//);
    assert.ok(product.sourceUrls.length > 0);
    product.sourceUrls.forEach((url) => assert.match(url, /^https:\/\//));
  }
});

test("catalog-only products cannot leak placeholder rewards into ranking", () => {
  const catalogOnly = products.filter((product) => product.comparisonStatus === "catalog_only");
  assert.ok(catalogOnly.length > 0);
  for (const product of catalogOnly) {
    assert.equal(product.baseReward.type, "cashback");
    assert.equal(product.baseReward.rate, 0);
    assert.equal(product.baseReward.pointValuePence, null);
    assert.deepEqual(product.rules, []);
  }
});

test("stateful caps and annual-spend tiers remain catalog-only", () => {
  const expectedCatalogOnly = [
    "amex-uk-cashback",
    "amex-uk-cashback-everyday",
    "pulse-mastercard",
    "santander-all-in-one-credit-card",
    "santander-world-elite-mastercard",
    "virgin-money-uk-everyday-cashback",
  ];
  for (const slug of expectedCatalogOnly) {
    assert.equal(products.find((product) => product.slug === slug)?.comparisonStatus, "catalog_only");
  }
});

test("merchant-specific Tesco rates remain out of ranking until domain rules exist", () => {
  for (const product of products.filter((item) => item.issuer === "Tesco Bank")) {
    assert.equal(product.comparisonStatus, "catalog_only");
    assert.deepEqual(product.rules, []);
    assert.equal(product.baseReward.rate, 0);
  }
});

test("only faithfully modelled ordinary GBP rewards are comparison-ready", () => {
  assert.deepEqual(
    products.filter((product) => product.comparisonStatus === "verified").map((product) => product.slug).sort(),
    [
      "amex-uk-nectar",
      "amex-uk-rewards-credit-card",
      "barclaycard-rewards",
      "halifax-cashback-credit-card",
      "ms-bank-purchase-plus",
      "ms-bank-transfer-plus",
    ],
  );
});

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = resolve(ROOT, "catalog/uk-credit-cards.json");
const MIGRATION_PATH = resolve(ROOT, "supabase/migrations/202609280001_uk_card_catalog.sql");
const ALLOWED_STATUSES = new Set(["verified", "catalog_only"]);
const ALLOWED_REWARD_TYPES = new Set(["cashback", "points", "miles"]);
const DISALLOWED_SOURCE_HOSTS = new Set([
  "comparethemarket.com",
  "finder.com",
  "forbes.com",
  "moneysavingexpert.com",
  "moneyfactscompare.co.uk",
  "nerdwallet.com",
  "thepointsguy.com",
  "uswitch.com",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isFiniteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateUrl(value, context) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${context} must be a valid URL.`);
  }
  invariant(url.protocol === "https:", `${context} must use HTTPS.`);
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  invariant(!DISALLOWED_SOURCE_HOSTS.has(hostname), `${context} must use a first-party source, not ${hostname}.`);
}

function validate(catalog) {
  invariant(catalog?.schemaVersion === 1, "schemaVersion must be 1.");
  invariant(/^uk-\d{4}\.\d{2}\.\d{2}$/.test(catalog?.release?.version), "Release version must look like uk-YYYY.MM.DD.");
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(catalog?.release?.reviewedAt), "reviewedAt must be an ISO date.");
  invariant(Array.isArray(catalog.products), "products must be an array.");
  invariant(catalog.products.length >= 50, `Expected at least 50 publishable products; found ${catalog.products.length}.`);

  const slugs = new Set();
  const identities = new Set();
  let verifiedCount = 0;

  for (const [index, product] of catalog.products.entries()) {
    const context = `products[${index}]`;
    invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug), `${context}.slug is invalid.`);
    invariant(!slugs.has(product.slug), `Duplicate slug: ${product.slug}.`);
    slugs.add(product.slug);
    invariant(typeof product.name === "string" && product.name.trim(), `${context}.name is required.`);
    invariant(typeof product.issuer === "string" && product.issuer.trim(), `${context}.issuer is required.`);
    const identity = `${product.issuer.toLowerCase()}::${product.name.toLowerCase()}`;
    invariant(!identities.has(identity), `Duplicate issuer/product identity: ${product.issuer} / ${product.name}.`);
    identities.add(identity);
    invariant(typeof product.network === "string" && product.network.trim(), `${context}.network is required.`);
    invariant(ALLOWED_STATUSES.has(product.comparisonStatus), `${context}.comparisonStatus is invalid.`);
    invariant(product.annualFeePence == null || isFiniteNonNegative(product.annualFeePence), `${context}.annualFeePence must be null or non-negative.`);
    validateUrl(product.sourceUrl, `${context}.sourceUrl`);
    if (product.termsUrl) validateUrl(product.termsUrl, `${context}.termsUrl`);
    invariant(Array.isArray(product.sourceUrls) && product.sourceUrls.length > 0, `${context}.sourceUrls is required.`);
    product.sourceUrls.forEach((url, sourceIndex) => validateUrl(url, `${context}.sourceUrls[${sourceIndex}]`));
    invariant(product.sourceCheckedAt === catalog.release.reviewedAt, `${context}.sourceCheckedAt must match the release review date.`);
    invariant(typeof product.notes === "string" && product.notes.trim(), `${context}.notes is required.`);
    invariant(product.baseReward && ALLOWED_REWARD_TYPES.has(product.baseReward.type), `${context}.baseReward.type is invalid.`);
    invariant(isFiniteNonNegative(product.baseReward.rate), `${context}.baseReward.rate must be non-negative.`);
    invariant(typeof product.baseReward.redemptionLabel === "string" && product.baseReward.redemptionLabel.trim(), `${context}.baseReward.redemptionLabel is required.`);

    if (product.comparisonStatus === "catalog_only") {
      invariant(product.baseReward.rate === 0, `${context} catalog-only products must have a zero placeholder rate.`);
    } else {
      verifiedCount += 1;
    }
    if (product.baseReward.type !== "cashback") {
      invariant(isFiniteNonNegative(product.baseReward.pointValuePence) && product.baseReward.pointValuePence > 0,
        `${context} points/miles products need a positive fixed cash-equivalent value.`);
    } else {
      invariant(product.baseReward.pointValuePence == null, `${context} cashback products must not set pointValuePence.`);
    }

    invariant(Array.isArray(product.rules), `${context}.rules must be an array.`);
    for (const [ruleIndex, rule] of product.rules.entries()) {
      const ruleContext = `${context}.rules[${ruleIndex}]`;
      invariant(product.comparisonStatus === "verified", `${ruleContext} cannot belong to a catalog-only product.`);
      invariant(Array.isArray(rule.categories) && rule.categories.length > 0, `${ruleContext}.categories is required.`);
      invariant(rule.categories.every((category) => typeof category === "string" && category.trim()), `${ruleContext}.categories is invalid.`);
      invariant(ALLOWED_REWARD_TYPES.has(rule.type), `${ruleContext}.type is invalid.`);
      invariant(isFiniteNonNegative(rule.rate), `${ruleContext}.rate must be non-negative.`);
      if (rule.type !== "cashback") {
        const pointValue = rule.pointValuePence ?? product.baseReward.pointValuePence;
        invariant(isFiniteNonNegative(pointValue) && pointValue > 0, `${ruleContext} needs a fixed cash-equivalent value.`);
      }
      invariant(rule.capPence == null || isFiniteNonNegative(rule.capPence), `${ruleContext}.capPence is invalid.`);
      invariant(typeof rule.label === "string" && rule.label.trim(), `${ruleContext}.label is required.`);
      if (rule.sourceUrl) validateUrl(rule.sourceUrl, `${ruleContext}.sourceUrl`);
    }
  }

  invariant(verifiedCount > 0, "At least one product must be verified for comparison.");
  return { products: catalog.products.length, verified: verifiedCount, catalogOnly: catalog.products.length - verifiedCount };
}

function sqlString(value) {
  if (value == null) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  return value == null ? "null" : String(value);
}

function deterministicUuid(namespace) {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

const PALETTES = [
  ["#173f3a", "#2f7467", "#c8ff62"],
  ["#1f3154", "#496aa3", "#d7e8ff"],
  ["#4d263d", "#9a4d72", "#ffd3e8"],
  ["#3f311d", "#8c6a32", "#ffe2a1"],
  ["#292a31", "#5b5e6b", "#e6e7eb"],
  ["#3c254f", "#7d50a2", "#ead6ff"],
];

function paletteFor(value) {
  const hash = createHash("sha256").update(value).digest();
  return PALETTES[hash[0] % PALETTES.length];
}

function productTuple(product, releaseId, reviewedAt) {
  const [from, to, accent] = paletteFor(product.issuer);
  return `(${[
    sqlString(deterministicUuid(`pip-card:${product.slug}`)),
    sqlString(releaseId),
    sqlString(product.slug),
    sqlString(product.name),
    sqlString(product.issuer),
    sqlString(product.network),
    "'GB'",
    "'GBP'",
    sqlString(product.baseReward.type),
    sqlNumber(product.baseReward.rate),
    sqlNumber(product.baseReward.pointValuePence),
    sqlNumber(product.annualFeePence),
    sqlString(product.baseReward.redemptionLabel),
    sqlString(`Official issuer material checked ${reviewedAt}`),
    sqlString(product.termsUrl ?? product.sourceUrl),
    sqlString(product.comparisonStatus),
    sqlString(product.sourceCheckedAt),
    sqlString(product.notes),
    sqlString(reviewedAt),
    sqlString(from),
    sqlString(to),
    sqlString(accent),
    "true",
  ].join(", ")})`;
}

function ruleTuple(product, rule, index, reviewedAt) {
  const id = deterministicUuid(`pip-rule:${product.slug}:${index}:${rule.label}`);
  const productId = deterministicUuid(`pip-card:${product.slug}`);
  const categories = `array[${rule.categories.map(sqlString).join(", ")}]::text[]`;
  return `(${[
    sqlString(id),
    sqlString(productId),
    categories,
    sqlString(rule.type),
    sqlNumber(rule.rate),
    sqlNumber(rule.pointValuePence),
    sqlNumber(rule.capPence),
    sqlString(rule.label),
    sqlNumber(rule.priority ?? 100),
    rule.requiresActivation ? "true" : "false",
    sqlString(rule.sourceUrl ?? product.sourceUrl),
    `${sqlString(`${reviewedAt}T00:00:00Z`)}::timestamptz`,
    "true",
  ].join(", ")})`;
}

function migrationSql(catalog) {
  const { version, reviewedAt } = catalog.release;
  const releaseId = deterministicUuid(`pip-release:${version}`);
  const productIds = catalog.products.map((product) => sqlString(deterministicUuid(`pip-card:${product.slug}`))).join(", ");
  const productRows = catalog.products.map((product) => productTuple(product, releaseId, reviewedAt)).join(",\n  ");
  const rules = catalog.products.flatMap((product) => product.rules.map((rule, index) => ruleTuple(product, rule, index, reviewedAt)));
  const ruleInsert = rules.length ? `
insert into public.reward_rules (
  id, card_product_id, categories, reward_type, rate, point_value_pence, reward_cap_pence,
  label, priority, requires_activation, source_url, retrieved_at, active
) values
  ${rules.join(",\n  ")};
` : "";

  return `begin;

alter table public.card_products
  add column if not exists comparison_status text not null default 'verified',
  add column if not exists source_checked_at date,
  add column if not exists data_notes text;

alter table public.card_products
  alter column annual_fee_pence drop not null;

alter table public.card_products
  drop constraint if exists card_products_comparison_status_check;
alter table public.card_products
  add constraint card_products_comparison_status_check
  check (comparison_status in ('verified', 'catalog_only'));

update public.catalog_releases
set status = 'retired'
where status = 'published' and version <> ${sqlString(version)};

insert into public.catalog_releases (id, version, status, published_at)
values (${sqlString(releaseId)}, ${sqlString(version)}, 'published', ${sqlString(`${reviewedAt}T00:00:00Z`)}::timestamptz)
on conflict (version) do update
set status = excluded.status, published_at = excluded.published_at;

update public.card_products
set active = false
where id not in (${productIds});

insert into public.card_products (
  id, release_id, slug, name, issuer, network, country_code, billing_currency,
  base_reward_type, base_reward_rate, point_value_pence, annual_fee_pence,
  redemption_label, terms_version, terms_url, comparison_status, source_checked_at,
  data_notes, valid_from, artwork_from, artwork_to, artwork_accent, active
) values
  ${productRows}
on conflict (slug) do update set
  release_id = excluded.release_id,
  name = excluded.name,
  issuer = excluded.issuer,
  network = excluded.network,
  base_reward_type = excluded.base_reward_type,
  base_reward_rate = excluded.base_reward_rate,
  point_value_pence = excluded.point_value_pence,
  annual_fee_pence = excluded.annual_fee_pence,
  redemption_label = excluded.redemption_label,
  terms_version = excluded.terms_version,
  terms_url = excluded.terms_url,
  comparison_status = excluded.comparison_status,
  source_checked_at = excluded.source_checked_at,
  data_notes = excluded.data_notes,
  valid_from = excluded.valid_from,
  artwork_from = excluded.artwork_from,
  artwork_to = excluded.artwork_to,
  artwork_accent = excluded.artwork_accent,
  active = true;

delete from public.reward_rules
where card_product_id in (${productIds});
${ruleInsert}
commit;
`;
}

const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
const counts = validate(catalog);

if (process.argv.includes("--write-migration")) {
  await writeFile(MIGRATION_PATH, migrationSql(catalog));
  console.log(`Wrote ${MIGRATION_PATH}`);
}

console.log(`Catalog valid: ${counts.products} products (${counts.verified} verified, ${counts.catalogOnly} catalog-only).`);

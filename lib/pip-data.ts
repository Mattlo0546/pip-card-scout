import "server-only";

import type { CardProduct, MerchantOffer, RewardRule, WalletCard } from "@/lib/rewards-engine";
import { messageFromUnknown } from "@/lib/api";
import { parseSupabaseResponse, restRequest } from "@/lib/supabase-rest";

type Row = Record<string, unknown>;

export class DataError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

async function rows(path: string, token: string): Promise<Row[]> {
  const response = await restRequest(path, { token });
  const payload = await parseSupabaseResponse(response);
  if (!response.ok) throw new DataError(messageFromUnknown(payload, "Database request failed."), response.status);
  if (!Array.isArray(payload)) throw new DataError("Database returned an unexpected response.");
  return payload.filter((item): item is Row => Boolean(item) && typeof item === "object");
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function mapProduct(row: Row): CardProduct {
  const rewardType = text(row.base_reward_type, "cashback");
  return {
    id: text(row.id),
    name: text(row.name),
    issuer: text(row.issuer),
    network: text(row.network, "Card"),
    billingCurrency: text(row.billing_currency, "GBP"),
    baseRewardType: rewardType === "points" || rewardType === "miles" ? rewardType : "cashback",
    baseRewardRate: numberValue(row.base_reward_rate),
    pointValuePence: row.point_value_pence === null ? null : numberValue(row.point_value_pence),
    annualFeePence: row.annual_fee_pence === null ? null : numberValue(row.annual_fee_pence),
    redemptionLabel: text(row.redemption_label, "Issuer rewards"),
    termsVersion: text(row.terms_version, "Terms not versioned"),
    termsUrl: optionalText(row.terms_url),
    comparisonStatus: row.comparison_status === "catalog_only" ? "catalog_only" : "verified",
    sourceCheckedAt: optionalText(row.source_checked_at),
    dataNotes: optionalText(row.data_notes),
    validFrom: optionalText(row.valid_from),
    validTo: optionalText(row.valid_to),
    artworkFrom: color(row.artwork_from, "#173f3a"),
    artworkTo: color(row.artwork_to, "#2f7467"),
    artworkAccent: color(row.artwork_accent, "#c8ff62"),
  };
}

export function mapWalletCard(row: Row): WalletCard {
  return {
    id: text(row.id),
    cardProductId: text(row.card_product_id),
    nickname: optionalText(row.nickname),
    lastFour: optionalText(row.last_four),
    enabled: row.enabled !== false,
    activatedCategories: stringArray(row.activated_categories),
  };
}

export function mapRule(row: Row): RewardRule {
  const rewardType = text(row.reward_type, "cashback");
  return {
    id: text(row.id),
    cardProductId: text(row.card_product_id),
    categories: stringArray(row.categories),
    rewardType: rewardType === "points" || rewardType === "miles" ? rewardType : "cashback",
    rate: numberValue(row.rate),
    pointValuePence: row.point_value_pence === null ? null : numberValue(row.point_value_pence),
    rewardCapPence: row.reward_cap_pence === null ? null : numberValue(row.reward_cap_pence),
    label: text(row.label),
    priority: numberValue(row.priority),
    requiresActivation: Boolean(row.requires_activation),
    validFrom: optionalText(row.valid_from),
    validTo: optionalText(row.valid_to),
  };
}

export function mapOffer(row: Row): MerchantOffer {
  return {
    id: text(row.id),
    cardProductId: text(row.card_product_id),
    merchantPattern: text(row.merchant_pattern),
    minSpendPence: numberValue(row.min_spend_pence),
    bonusPence: numberValue(row.bonus_pence),
    currency: text(row.currency, "GBP"),
    label: text(row.label),
    startsAt: optionalText(row.starts_at),
    endsAt: optionalText(row.ends_at),
  };
}

export async function loadCatalog(token: string): Promise<CardProduct[]> {
  const data = await rows(
    "card_products?select=id,name,issuer,network,billing_currency,base_reward_type,base_reward_rate,point_value_pence,annual_fee_pence,redemption_label,terms_version,terms_url,comparison_status,source_checked_at,data_notes,valid_from,valid_to,artwork_from,artwork_to,artwork_accent&active=eq.true&order=issuer.asc,name.asc",
    token,
  );
  return data.map(mapProduct);
}

export async function loadWallet(token: string, userId: string): Promise<WalletCard[]> {
  const data = await rows(
    `user_wallet_cards?select=id,card_product_id,nickname,last_four,enabled,activated_categories&user_id=eq.${userId}&order=created_at.asc`,
    token,
  );
  return data.map(mapWalletCard);
}

function inFilter(ids: string[]): string {
  return `in.(${ids.join(",")})`;
}

export async function loadRules(token: string, productIds: string[]): Promise<RewardRule[]> {
  if (!productIds.length) return [];
  const data = await rows(
    `reward_rules?select=id,card_product_id,categories,reward_type,rate,point_value_pence,reward_cap_pence,label,priority,requires_activation,valid_from,valid_to&card_product_id=${inFilter(productIds)}&active=eq.true`,
    token,
  );
  return data.map(mapRule);
}

export async function loadOffers(token: string, productIds: string[]): Promise<MerchantOffer[]> {
  if (!productIds.length) return [];
  const data = await rows(
    `merchant_offers?select=id,card_product_id,merchant_pattern,min_spend_pence,bonus_pence,currency,label,starts_at,ends_at&card_product_id=${inFilter(productIds)}&active=eq.true`,
    token,
  );
  return data.map(mapOffer);
}

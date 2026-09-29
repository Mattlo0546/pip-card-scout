export type RewardKind = "cashback" | "points" | "miles";

export type CardProduct = {
  id: string;
  name: string;
  issuer: string;
  network: string;
  billingCurrency: string;
  baseRewardType: RewardKind;
  baseRewardRate: number;
  pointValuePence: number | null;
  annualFeePence: number | null;
  redemptionLabel: string;
  termsVersion: string;
  termsUrl: string | null;
  comparisonStatus: "verified" | "catalog_only";
  sourceCheckedAt: string | null;
  dataNotes: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  artworkFrom: string;
  artworkTo: string;
  artworkAccent: string;
};

export type RewardRule = {
  id: string;
  cardProductId: string;
  categories: string[];
  rewardType: RewardKind;
  rate: number;
  pointValuePence: number | null;
  rewardCapPence: number | null;
  label: string;
  priority: number;
  requiresActivation: boolean;
  validFrom?: string | null;
  validTo?: string | null;
};

export type MerchantOffer = {
  id: string;
  cardProductId: string;
  merchantPattern: string;
  minSpendPence: number;
  bonusPence: number;
  currency: string;
  label: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type WalletCard = {
  id: string;
  cardProductId: string;
  nickname: string | null;
  lastFour: string | null;
  enabled: boolean;
  activatedCategories: string[];
};

export type CheckoutContext = {
  merchant: string;
  category: string;
  amountPence: number;
  currency: string;
  inferredMcc: string | null;
  confidence: number;
  url: string | null;
  amountDetected: boolean;
};

export type RankedCard = {
  walletCardId: string;
  cardProductId: string;
  cardName: string;
  issuer: string;
  nickname: string | null;
  lastFour: string | null;
  network: string;
  artwork: [string, string, string];
  valuePence: number;
  categoryValuePence: number;
  offerValuePence: number;
  valueLabel: string;
  rewardLabel: string;
  earnLabel: string;
  reason: string;
  sourceLabel: string;
  redemptionLabel: string;
  rewardCapPence: number | null;
  matchedCategoryRule: boolean;
  appliedOffers: Array<{ id: string; label: string; valuePence: number }>;
};

const CATEGORY_ALIASES: Record<string, string> = {
  apparel: "fashion",
  clothing: "fashion",
  clothes: "fashion",
  vintage: "fashion",
  supermarket: "groceries",
  grocery: "groceries",
  restaurant: "dining",
  takeaway: "dining",
  food: "dining",
  airline: "travel",
  hotel: "travel",
  rideshare: "transit",
  transport: "transit",
  streaming: "subscriptions",
  software: "subscriptions",
  tech: "electronics",
  technology: "electronics",
  ecommerce: "online",
  "e-commerce": "online",
  office: "business",
};

export function normalizeCategory(value: string): string {
  const clean = String(value || "general").trim().toLowerCase();
  if (CATEGORY_ALIASES[clean]) return CATEGORY_ALIASES[clean];
  const partial = Object.entries(CATEGORY_ALIASES).find(([alias]) => clean.includes(alias));
  return partial?.[1] ?? clean ?? "general";
}

export function formatMoney(pence: number, currency = "GBP"): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(pence / 100);
  } catch {
    return `£${(pence / 100).toFixed(2)}`;
  }
}

function estimateEarn(
  amountPence: number,
  kind: RewardKind,
  rate: number,
  pointValuePence: number | null,
  capPence: number | null,
) {
  let valuePence = 0;
  let units = 0;
  const scaledRate = Math.round(Math.max(0, rate) * 10_000);

  if (kind === "cashback") {
    valuePence = Math.round((amountPence * scaledRate) / 1_000_000);
  } else {
    units = Math.floor((amountPence * scaledRate) / 1_000_000);
    const scaledPointValue = Math.round(Math.max(0, pointValuePence ?? 0) * 10_000);
    valuePence = Math.round((units * scaledPointValue) / 10_000);
  }

  if (capPence !== null) valuePence = Math.min(valuePence, capPence);
  return { valuePence: Math.max(0, valuePence), units };
}

function offerIsActive(offer: MerchantOffer, context: CheckoutContext, now: Date): boolean {
  if (offer.currency !== context.currency) return false;
  if (context.amountPence < offer.minSpendPence) return false;
  const merchant = context.merchant.toLowerCase();
  const pattern = offer.merchantPattern.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`, "i").test(merchant)) return false;
  if (offer.startsAt && now < new Date(offer.startsAt)) return false;
  if (offer.endsAt && now > new Date(offer.endsAt)) return false;
  return true;
}

function isWithinWindow(validFrom: string | null | undefined, validTo: string | null | undefined, now: Date) {
  if (validFrom && now < new Date(validFrom)) return false;
  if (validTo && now > new Date(validTo)) return false;
  return true;
}

export function rankWallet(input: {
  wallet: WalletCard[];
  products: CardProduct[];
  rules: RewardRule[];
  offers: MerchantOffer[];
  context: CheckoutContext;
  now?: Date;
}): RankedCard[] {
  const { wallet, products, rules, offers, context } = input;
  const now = input.now ?? new Date();
  const category = normalizeCategory(context.category);
  const productsById = new Map(products.map((product) => [product.id, product]));

  return wallet
    .filter((walletCard) => walletCard.enabled)
    .flatMap((walletCard) => {
      const product = productsById.get(walletCard.cardProductId);
      if (
        !product ||
        product.comparisonStatus === "catalog_only" ||
        product.billingCurrency !== context.currency ||
        !isWithinWindow(product.validFrom, product.validTo, now)
      ) return [];

      const eligibleRules = (context.confidence >= 0.8 ? rules : [])
        .filter((rule) =>
          rule.cardProductId === product.id &&
          rule.categories.map(normalizeCategory).includes(category) &&
          (!rule.requiresActivation || walletCard.activatedCategories.map(normalizeCategory).includes(category)) &&
          isWithinWindow(rule.validFrom, rule.validTo, now),
        )
        .map((rule) => ({
          rule,
          estimate: estimateEarn(
            context.amountPence,
            rule.rewardType,
            rule.rate,
            rule.pointValuePence ?? product.pointValuePence,
            rule.rewardCapPence,
          ),
        }))
        .sort((a, b) => b.estimate.valuePence - a.estimate.valuePence || b.rule.priority - a.rule.priority);

      const matched = eligibleRules[0] ?? null;
      const baseEstimate = estimateEarn(
        context.amountPence,
        product.baseRewardType,
        product.baseRewardRate,
        product.pointValuePence,
        null,
      );
      const earn = matched?.estimate ?? baseEstimate;
      const appliedOffers = offers
        .filter((offer) => offer.cardProductId === product.id && offerIsActive(offer, context, now))
        .map((offer) => ({ id: offer.id, label: offer.label, valuePence: offer.bonusPence }));
      const offerValuePence = appliedOffers.reduce((sum, offer) => sum + offer.valuePence, 0);
      const valuePence = earn.valuePence + offerValuePence;
      const rewardKind = matched?.rule.rewardType ?? product.baseRewardType;
      const rate = matched?.rule.rate ?? product.baseRewardRate;
      const earnLabel = matched?.rule.label ?? (rewardKind === "cashback"
        ? `${rate}% base cashback`
        : `${rate} ${rewardKind} per £1 base`);
      const rewardLabel = rewardKind === "cashback"
        ? `${formatMoney(earn.valuePence, context.currency)} back${offerValuePence ? ` + ${formatMoney(offerValuePence, context.currency)} offer` : ""}`
        : `${earn.units.toLocaleString("en-GB")} ${rewardKind} · est. ${formatMoney(earn.valuePence, context.currency)}${offerValuePence ? ` + ${formatMoney(offerValuePence, context.currency)} offer` : ""}`;

      return [{
        walletCardId: walletCard.id,
        cardProductId: product.id,
        cardName: product.name,
        issuer: product.issuer,
        nickname: walletCard.nickname,
        lastFour: walletCard.lastFour,
        network: product.network,
        artwork: [product.artworkFrom, product.artworkTo, product.artworkAccent] as [string, string, string],
        valuePence,
        categoryValuePence: earn.valuePence,
        offerValuePence,
        valueLabel: formatMoney(valuePence, context.currency),
        rewardLabel,
        earnLabel,
        reason: `${matched ? `${earnLabel} applies to ${category}.` : `${product.name} falls back to its base earn rate.`}${appliedOffers.length ? ` ${appliedOffers.map((offer) => offer.label).join(" and ")} also applies.` : ""}`,
        sourceLabel: `${product.termsVersion}${product.termsUrl ? ` · ${product.termsUrl}` : ""}`,
        redemptionLabel: product.redemptionLabel,
        rewardCapPence: matched?.rule.rewardCapPence ?? null,
        matchedCategoryRule: Boolean(matched),
        appliedOffers,
      } satisfies RankedCard];
    })
    .sort((a, b) =>
      b.valuePence - a.valuePence ||
      Number(b.matchedCategoryRule) - Number(a.matchedCategoryRule) ||
      a.cardName.localeCompare(b.cardName),
    );
}

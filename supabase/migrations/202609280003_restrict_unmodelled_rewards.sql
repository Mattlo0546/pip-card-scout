begin;

-- Keep products searchable in the real-card catalogue, but do not rank cards
-- whose material earn rules need state that Pip does not model yet. This avoids
-- presenting a precise-looking but incorrect winner.
update public.card_products
set
  comparison_status = 'catalog_only',
  base_reward_type = 'cashback',
  base_reward_rate = 0,
  point_value_pence = null,
  redemption_label = 'Catalogued for identification; reward comparison pending'
where slug in (
  'amazon-barclaycard',
  'aqua-classic',
  'bip-digital-credit',
  'capital-one-balance-transfer',
  'capital-one-classic',
  'jaja-vanta',
  'john-lewis-partnership-credit-card',
  'lloyds-ultra-credit-card',
  'ms-bank-rewards',
  'natwest-reward-black-credit-card',
  'natwest-travel-reward-credit-card',
  'post-office-credit-card',
  'post-office-travel-credit-card',
  'rbs-reward-black-credit-card',
  'rbs-reward-credit-card',
  'santander-rewards-credit-card',
  'tesco-bank-all-round',
  'tesco-bank-balance-transfer-and-purchases',
  'tesco-bank-everyday-low-apr',
  'tesco-bank-foundation',
  'vanquis-balance-transfer',
  'vanquis-low-apr-balance-transfer',
  'vanquis-travel',
  'yonder-premium-credit'
);

delete from public.reward_rules
where card_product_id in (
  select id
  from public.card_products
  where comparison_status = 'catalog_only'
);

update public.user_wallet_cards
set enabled = false
where card_product_id in (
  select id
  from public.card_products
  where comparison_status = 'catalog_only'
);

commit;

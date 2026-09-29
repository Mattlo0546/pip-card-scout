create extension if not exists pgcrypto;

create type public.catalog_status as enum ('draft', 'published', 'retired');
create type public.reward_kind as enum ('cashback', 'points', 'miles');

create table public.catalog_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  status public.catalog_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint published_release_has_timestamp check (status <> 'published' or published_at is not null)
);

create table public.card_products (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.catalog_releases(id) on delete restrict,
  slug text not null unique,
  name text not null,
  issuer text not null,
  network text not null,
  country_code text not null default 'GB' check (country_code ~ '^[A-Z]{2}$'),
  billing_currency text not null default 'GBP' check (billing_currency ~ '^[A-Z]{3}$'),
  base_reward_type public.reward_kind not null,
  base_reward_rate numeric(12, 4) not null check (base_reward_rate >= 0),
  point_value_pence numeric(12, 4) check (point_value_pence is null or point_value_pence >= 0),
  annual_fee_pence bigint not null default 0 check (annual_fee_pence >= 0),
  redemption_label text not null,
  terms_version text not null,
  terms_url text,
  terms_sha256 text,
  valid_from date,
  valid_to date,
  artwork_from text not null default '#173f3a' check (artwork_from ~ '^#[0-9A-Fa-f]{6}$'),
  artwork_to text not null default '#2f7467' check (artwork_to ~ '^#[0-9A-Fa-f]{6}$'),
  artwork_accent text not null default '#c8ff62' check (artwork_accent ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint non_cashback_products_have_a_unit_value check (base_reward_type = 'cashback' or point_value_pence is not null),
  constraint card_product_validity check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create table public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  card_product_id uuid not null references public.card_products(id) on delete cascade,
  categories text[] not null check (cardinality(categories) > 0),
  reward_type public.reward_kind not null,
  rate numeric(12, 4) not null check (rate >= 0),
  point_value_pence numeric(12, 4) check (point_value_pence is null or point_value_pence >= 0),
  reward_cap_pence bigint check (reward_cap_pence is null or reward_cap_pence >= 0),
  label text not null,
  priority smallint not null default 0,
  requires_activation boolean not null default false,
  source_url text,
  retrieved_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint reward_rule_validity check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create table public.merchant_offers (
  id uuid primary key default gen_random_uuid(),
  card_product_id uuid not null references public.card_products(id) on delete cascade,
  merchant_pattern text not null check (length(merchant_pattern) between 2 and 120),
  min_spend_pence bigint not null default 0 check (min_spend_pence >= 0),
  bonus_pence bigint not null check (bonus_pence >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  label text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  source_url text,
  terms_sha256 text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint merchant_offer_validity check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cloud_history boolean not null default false,
  retention_days integer not null default 90 check (retention_days between 0 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_wallet_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_product_id uuid not null references public.card_products(id) on delete restrict,
  nickname text check (nickname is null or length(nickname) <= 40),
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  enabled boolean not null default true,
  activated_categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, card_product_id)
);

create table public.recommendation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant text not null check (length(merchant) <= 120),
  site_url text check (site_url is null or length(site_url) <= 300),
  category text not null check (length(category) <= 40),
  inferred_mcc text,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  amount_pence bigint not null check (amount_pence > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_detected boolean not null,
  chosen_wallet_card_id uuid not null references public.user_wallet_cards(id) on delete restrict,
  estimated_value_pence bigint not null check (estimated_value_pence >= 0),
  runner_up_value_pence bigint check (runner_up_value_pence is null or runner_up_value_pence >= 0),
  explanation jsonb not null,
  rules_version text not null,
  created_at timestamptz not null default now()
);

create index user_wallet_cards_user_id_idx on public.user_wallet_cards(user_id);
create index recommendation_events_user_created_idx on public.recommendation_events(user_id, created_at desc);
create index reward_rules_product_idx on public.reward_rules(card_product_id) where active;
create index merchant_offers_product_idx on public.merchant_offers(card_product_id) where active;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_wallet_cards_set_updated_at
before update on public.user_wallet_cards
for each row execute function public.set_updated_at();

create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

alter table public.catalog_releases enable row level security;
alter table public.card_products enable row level security;
alter table public.reward_rules enable row level security;
alter table public.merchant_offers enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_wallet_cards enable row level security;
alter table public.recommendation_events enable row level security;

revoke all on public.catalog_releases from anon, authenticated;
revoke all on public.card_products from anon, authenticated;
revoke all on public.reward_rules from anon, authenticated;
revoke all on public.merchant_offers from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.user_settings from anon, authenticated;
revoke all on public.user_wallet_cards from anon, authenticated;
revoke all on public.recommendation_events from anon, authenticated;

grant select on public.catalog_releases, public.card_products, public.reward_rules, public.merchant_offers to authenticated;
grant select, insert, update, delete on public.profiles, public.user_settings, public.user_wallet_cards to authenticated;
grant select, delete on public.recommendation_events to authenticated;

create policy "published catalog releases are readable"
on public.catalog_releases for select to authenticated
using (status = 'published');

create policy "published card products are readable"
on public.card_products for select to authenticated
using (exists (
  select 1 from public.catalog_releases release
  where release.id = card_products.release_id and release.status = 'published'
));

create policy "published reward rules are readable"
on public.reward_rules for select to authenticated
using (exists (
  select 1 from public.card_products product
  join public.catalog_releases release on release.id = product.release_id
  where product.id = reward_rules.card_product_id and release.status = 'published'
));

create policy "published merchant offers are readable"
on public.merchant_offers for select to authenticated
using (exists (
  select 1 from public.card_products product
  join public.catalog_releases release on release.id = product.release_id
  where product.id = merchant_offers.card_product_id and release.status = 'published'
));

create policy "users read their profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);
create policy "users update their profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users read their settings"
on public.user_settings for select to authenticated
using ((select auth.uid()) = user_id);
create policy "users add their settings"
on public.user_settings for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "users update their settings"
on public.user_settings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users delete their settings"
on public.user_settings for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "users read their wallet"
on public.user_wallet_cards for select to authenticated
using ((select auth.uid()) = user_id);
create policy "users add to their wallet"
on public.user_wallet_cards for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "users update their wallet"
on public.user_wallet_cards for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users remove from their wallet"
on public.user_wallet_cards for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "users read their recommendations"
on public.recommendation_events for select to authenticated
using ((select auth.uid()) = user_id);
create policy "users delete their recommendations"
on public.recommendation_events for delete to authenticated
using ((select auth.uid()) = user_id);

comment on table public.user_wallet_cards is
  'Non-sensitive wallet metadata only. Never add PAN, expiry, CVC, billing address, or cardholder name columns.';

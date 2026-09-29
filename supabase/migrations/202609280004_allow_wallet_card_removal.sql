begin;

alter table public.recommendation_events
  drop constraint if exists recommendation_events_chosen_wallet_card_id_fkey;

alter table public.recommendation_events
  alter column chosen_wallet_card_id drop not null;

alter table public.recommendation_events
  add constraint recommendation_events_chosen_wallet_card_id_fkey
  foreign key (chosen_wallet_card_id)
  references public.user_wallet_cards(id)
  on delete set null;

commit;

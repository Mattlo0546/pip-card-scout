# Pip production architecture

Pip is a Chrome extension with a backend, not a web application. Vercel runs the API/BFF only; Supabase provides Auth and Postgres; GitHub Releases distribute the extension package. The API root intentionally returns machine-readable service metadata rather than a consumer interface.

## Trust boundaries

The merchant page is untrusted. The content script may read only enough checkout context to form `{ merchant, category, inferredMcc, confidence, amountPence, currency }`. It does not receive tokens, the full wallet, last four digits, or catalog data. The service worker validates that DTO and replaces its URL with the active tab’s origin before calling the API.

The extension service worker is trusted client code, but not a source of truth. The API verifies every bearer token with Supabase Auth, re-loads the caller’s wallet under RLS, and performs the ranking again. A client cannot submit its own winner or estimated value.

The service-role key exists only in the Next.js server environment. It is used narrowly to write a server-attested decision after the authenticated user has opted into cloud history. Authenticated clients have no direct INSERT grant on the recommendation ledger.

Unpacked Chrome extensions receive installation-specific origins, so the API cannot rely on a single `chrome-extension://` origin as an authentication boundary. It uses bearer-token authentication rather than cookies and permits cross-origin API calls. The production manifest still limits the extension itself to the exact Pip API host. Valid tokens, input validation, ownership checks, RLS, and rate limiting—not CORS—protect private data.

## Database ownership

- `catalog_releases`, `card_products`, `reward_rules`, `merchant_offers`: authenticated read-only catalog; RLS exposes published releases only.
- `profiles`, `user_settings`, `user_wallet_cards`: private rows owned by `auth.uid()`.
- `recommendation_events`: private, user-readable/deletable ledger; server-only writes.

The schema contains no column capable of holding a full card number, CVC, expiry, billing address, or cardholder name.

## Recommendation semantics

The engine uses integer minor units and a fixed four-decimal scaling for rates and point values. It selects the most valuable eligible rule for the inferred category, adds active merchant offers whose thresholds are met, then sorts by value, category match, and stable card name.

Each card product is either `verified` or `catalog_only`. Catalogue-only cards remain searchable for wallet identification but are disabled and excluded from ranking. This prevents a variable point valuation, monthly cap, annual-spend tier, or personalised promotion from being represented as a deterministic checkout value.

When category confidence is below 80%, category bonus rules are ignored and cards compete on their base rate. Merchant category remains an estimate until settlement. Products whose billing currency differs from the checkout currency are excluded; the catalogue therefore supports GBP only.

## Privacy

Cloud history defaults off. When enabled, Pip saves the merchant label, site origin, category/MCC estimate, checkout total, chosen wallet-card ID, value estimate, runner-up value, rule version, and explanation. It never sends raw page text, a URL path/query, line items, form values, or payment credentials.

The current retention preference is 90 days, but automated retention enforcement is not yet implemented. A user can disable future history, remove wallet-card references, or permanently delete the account and its stored wallet and history from the extension. Account export is not yet implemented; retention enforcement and export are explicit beta limitations and broader-launch requirements.

## Threats addressed

- A page cannot trigger Pip by dispatching a DOM event.
- A page cannot mark fake fields and cause credentials to be filled.
- A page cannot read the decision from its `localStorage` or a `CustomEvent`.
- A content script cannot read session storage.
- A fabricated client result cannot enter the decision ledger.
- User A cannot access User B’s wallet or ledger under RLS.

The closed Shadow DOM reduces page-level inspection of the explanation, but it is not a DRM boundary. The injected result therefore omits last four digits and other account metadata.

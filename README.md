# Pip — the card scout at checkout

Pip is a Chrome extension that recommends the best rewards card from the cards a user already owns. At checkout, it combines the merchant category and purchase total with a source-backed UK credit-card catalogue, then compares cashback, points, miles, thresholds, caps, and eligible merchant offers.

This repository is the product: the Manifest V3 extension, its reward engine, the card catalogue, database migrations, and the small API the extension needs. There is no consumer website. The Vercel deployment is an API backend only.

> **Release status:** the extension and hosted backend are suitable for controlled beta testing. Unrestricted public account creation is not launch-ready until production Auth uses a custom SMTP provider and CAPTCHA/abuse controls instead of Supabase's default email service. Installation is manual through Google Chrome Developer mode.

## Install in Google Chrome

Pip is currently distributed as a GitHub release rather than through the Chrome Web Store.

1. Open the [latest GitHub release](https://github.com/Mattlo0546/pip-card-scout/releases/latest) and download the extension ZIP.
2. Unzip it to a permanent folder.
3. In Google Chrome, open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked**, then choose the unzipped folder containing `manifest.json`.
6. Pin Pip from Chrome's Extensions menu.
7. Open Pip, create an account, confirm the email if prompted, and sign in.
8. Add the card products you actually own. On an HTTPS checkout page with a visible GBP total, open Pip and select **Find my best card**.

Chrome does not install extensions directly from a ZIP, so it must be unzipped first. Developer mode is required until Pip is published in the Chrome Web Store.

## What “add my cards” means

Chrome does not expose a public extension API for reading cards saved in Chrome Payments. Pip therefore asks a user to identify each card product they own from the catalogue. A nickname and last four digits are optional labels.

Pip never asks for, stores, transmits, or fills:

- a full card number (PAN);
- CVC or CVV;
- expiry date;
- cardholder name or billing address; or
- Chrome Autofill payment data.

After Pip recommends a product, the user chooses the matching payment card in Chrome Autofill. Pip does not verify card ownership and cannot make the final payment selection on the user's behalf.

## How it works

```text
user opens Pip at checkout
  └─ content script reads merchant/category/GBP total
       └─ extension service worker calls the fixed Pip API
            └─ Vercel API verifies the Supabase user
                 ├─ loads that user's wallet under row-level security
                 ├─ loads the published card and reward rules
                 └─ ranks eligible cards with deterministic arithmetic
       └─ Pip shows the winner and explanation
            └─ user selects the card in Chrome Autofill
```

Vercel is used because an extension must not contain database administrator credentials or trust client-side ranking results. It hosts only authentication proxies and JSON endpoints for the catalogue, wallet, settings, history, and recommendations. Visiting [`pip-card-scout.vercel.app`](https://pip-card-scout.vercel.app) returns service information rather than a consumer interface.

Supabase provides email/password authentication and Postgres. Private wallet rows are protected with row-level security. Session tokens live in `chrome.storage.session`, are unavailable to page scripts, and disappear with the browser session.

## UK card catalogue

The published `uk-2026.09.28` catalogue contains 58 current UK consumer credit-card products from 22 issuer or programme groups, based on official first-party sources checked on 28 September 2026.

- 6 products have reward terms that Pip can compare deterministically.
- 52 products are catalogue-only. A user can identify the product, but it remains disabled for recommendations until Pip can represent its annual-spend tiers, account-age rules, cap usage, activation state, or variable redemption value safely.
- Introductory bonuses and personalised offers are not treated as recurring base earn rates.
- Closed programmes and non-credit products are excluded.

The normalized source of truth is [`catalog/uk-credit-cards.json`](./catalog/uk-credit-cards.json). Source receipts live in [`research/uk-card-catalog/`](./research/uk-card-catalog/).

```bash
npm run catalog:normalize
npm run catalog:build
npm run catalog:validate
```

Card terms change. Users should check an issuer's current terms before relying on a recommendation.

## Current limitations

Pip is an installable controlled beta, not financial advice and not a payment service.

- Recommendations currently support GBP checkouts and verified products only.
- Merchant category and MCC are inferred before settlement and may differ from the issuer's classification.
- Generic checkout detection works on many sites but not every checkout design, iframe, or dynamically rendered total.
- The engine does not yet track every annual fee, foreign-exchange fee, returns adjustment, reward cap, offer activation, or previously used allowance.
- Catalogue updates require human review; issuer terms can change between releases.
- Cloud decision history is off by default. Automated retention enforcement and account export are not yet implemented.
- GitHub installation requires Developer mode; Chrome Web Store installation is not available yet.
- Public self-service onboarding still requires production SMTP, CAPTCHA, and abuse-control configuration. Supabase's default email service is not suitable for unrestricted signups.

See [Privacy](./PRIVACY.md), [Support](./SUPPORT.md), and [Security](./SECURITY.md) before using the hosted beta.

## Develop locally

Prerequisites: Node.js 24+, Docker, and the Supabase CLI.

```bash
npm install
supabase start
supabase db reset
cp .env.example .env.local
npm run dev
```

Use the local Supabase output for `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. For a local extension/API run, follow [`extension/README.md`](./extension/README.md); the checked-in extension is deliberately locked to the production API.

Run the verification commands sequentially because the build and typecheck both use generated Next.js types:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run extension:package
```

The packaging command validates the production manifest and writes an installable ZIP under `dist/`. CI runs the same checks and publishes the ZIP as a workflow artifact. Maintainers attach that exact artifact to a tagged GitHub release; see the [deployment guide](./docs/deployment.md).

## API

All user endpoints except health and authentication require a Supabase access token as `Authorization: Bearer <token>`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/auth/sign-up` | Create a Supabase user |
| `POST /api/v1/auth/sign-in` | Start an extension session |
| `POST /api/v1/auth/refresh` | Rotate an expired access token |
| `POST /api/v1/auth/sign-out` | Revoke the Supabase session |
| `GET /api/v1/catalog` | Read the published product and rule catalogue |
| `GET/POST /api/v1/wallet` | Read or add wallet-card references |
| `PATCH/DELETE /api/v1/wallet/:id` | Enable, disable, or remove a wallet-card reference |
| `GET/PATCH /api/v1/settings` | Read or change private-history consent |
| `GET /api/v1/history` | Read the user's private recommendation ledger |
| `POST /api/v1/recommend` | Rank the authenticated wallet and optionally log the decision |
| `DELETE /api/v1/account` | Permanently delete the authenticated account and its stored data |
| `GET /api/health` | Check backend readiness |

For trust boundaries and deployment details, see [production architecture](./docs/production-architecture.md) and [deployment](./docs/deployment.md).

## Contributing and licence

Contributions are welcome; catalogue changes must include current first-party issuer evidence. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

The code is available under the [MIT License](./LICENSE).

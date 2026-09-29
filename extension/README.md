# Pip Chrome extension

This directory contains Pip's production Manifest V3 client. The checked-in build talks only to `https://pip-card-scout.vercel.app`, the JSON API backed by Supabase. It contains no database keys, card numbers, or local copy of the reward catalogue.

## Install the released extension

Use the packaged artifact from the [latest GitHub release](https://github.com/Mattlo0546/pip-card-scout/releases/latest), not a hand-built archive of the repository.

This is currently a controlled beta installed manually in Google Chrome Developer mode. The hosted operator must configure production SMTP, CAPTCHA, and signup abuse controls before opening unrestricted public account creation.

1. Download and unzip the extension ZIP.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the unzipped folder containing `manifest.json`.
5. Pin Pip, create an account, and add the card products you own.
6. Open an HTTPS checkout with a visible GBP total, click the Pip toolbar icon, and request a recommendation.

Opening the toolbar popup grants temporary `activeTab` access. Pip injects its detector only after that user gesture; it does not run automatically on every page.

## Data flow

- `popup.js` renders authentication, checkout context, wallet management, recommendations, and privacy controls.
- `background.js` is the only extension context that can access session tokens or call the API.
- `content.js` extracts a minimal merchant/category/amount object and displays the returned recommendation in a closed Shadow DOM.
- `content.css` styles the isolated result panel.
- `config.js` contains the public, non-secret API origin.

The extension identifies a user's card by catalogue product ID, with an optional nickname and last four digits. It never collects a PAN, CVC, expiry date, cardholder name, billing address, or Chrome Autofill data, and it never fills payment fields.

## Checkout detection

Pip uses conservative generic detection for merchant, category, and final total. A merchant may also provide this optional deterministic integration contract:

```html
<section
  data-pip-checkout
  data-pip-merchant="Example Shop"
  data-pip-category="fashion"
  data-pip-amount="86.40"
  data-pip-currency="GBP"
>
  <span data-pip-total>£86.40</span>
  <div data-pip-payment></div>
</section>
```

There are deliberately no attributes or code paths for payment credentials. If Pip cannot detect a supported final total with sufficient confidence, it stops instead of silently guessing.

## Session model

Access and refresh tokens live in `chrome.storage.session`, restricted to trusted extension contexts. Users sign in again after the browser session ends. Tokens never enter `storage.sync`, a content script, page storage, or DOM events.

## Local backend development

The production package intentionally permits only the production HTTPS API. For an isolated local test, temporarily update all three locations together:

1. `config.js` → `apiBaseUrl`
2. `manifest.json` → `host_permissions`
3. `manifest.json` → `content_security_policy.extension_pages` `connect-src`

Use `http://localhost:3000` only for local development, load this directory unpacked, and revert those changes before packaging or committing. The package validator rejects development hosts.

## Build a release artifact

From the repository root:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run extension:package
```

The packaging command uses an explicit allow-list, validates that only the production API is permitted, rejects credential-like content and development hosts, and writes the release ZIP under `dist/`. Distribute that generated ZIP; do not include environment files, source maps, research data, backend code, or local fixtures.

See [`docs/deployment.md`](../docs/deployment.md) for the maintainer release process.

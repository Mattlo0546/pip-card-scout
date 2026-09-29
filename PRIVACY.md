# Privacy notice

Effective: 28 September 2026

This notice describes data handled by the hosted Pip Card Scout beta and the Pip Chrome extension. Pip helps a user compare rewards on card products they already own. It is not a payment processor and does not complete purchases.

## Data Pip handles

### Account and session

- Email address for account creation, confirmation, and sign-in.
- Authentication credentials submitted to the authentication service. Pip's application database does not store the plain-text password; Supabase Auth stores the account credential securely.
- Short-lived access and refresh tokens. In Chrome they are stored in `chrome.storage.session`, restricted to trusted extension contexts, and cleared with the browser session.

### Wallet

- The catalogue identifier for each card product a user says they own.
- An optional nickname and optional last four digits used only to distinguish the user's cards.
- Whether the card is enabled and any supported category activation state.

### Checkout and recommendation

To calculate a recommendation, Pip processes the merchant label, site origin, inferred category/MCC and confidence, final amount, and currency. The API combines that context with the user's wallet and the published reward rules.

Cloud decision history is off by default. If a user enables it, Pip may retain the merchant label, site origin, category/MCC estimate, amount and currency, chosen wallet-card reference, estimated reward value, runner-up value, rule version, and explanation.

Infrastructure providers may process ordinary security and delivery metadata such as IP address, timestamp, response status, and user agent. Application logging should redact authentication headers and request bodies.

## Data Pip does not collect

Pip does not ask for, store, transmit, or fill:

- a full payment-card number (PAN);
- CVC/CVV or expiry date;
- cardholder name or billing address;
- cards saved in Chrome Payments or Chrome Autofill;
- payment-form values;
- purchased line items, raw page text, or URL paths and query strings; or
- bank account credentials.

The optional last four digits are not sufficient to make a payment. Users should never send full payment credentials in a support request, issue, or security report.

## Why the data is used

Pip uses this data to authenticate the user, maintain their private wallet, compare applicable rewards, show an explanation, prevent abuse, diagnose failures, and—only when enabled—show private recommendation history. Referral or affiliate economics are not ranking inputs.

Pip does not sell personal data or share it with card issuers for advertising.

## Service providers

- **Supabase** provides authentication and the Postgres database.
- **Vercel** hosts the API used by the extension.
- **GitHub** hosts source code and extension release downloads; GitHub is not given Pip account or wallet data by the extension.

These providers process data under their own terms and may operate infrastructure in multiple regions.

## Retention and user controls

- Session tokens remain in Chrome session storage until sign-out or the browser session ends.
- Wallet-card references remain until the user removes them or deletes the account.
- Cloud history is off by default and can be disabled at any time. The database currently records a 90-day retention preference, but automated retention enforcement is not yet implemented.
- The extension can remove individual wallet-card references and permanently delete the account together with its stored wallet and recommendation history. A history-only deletion control and data export are not yet available in this beta.

For a manual access or export request, or help when account deletion fails, follow the private-contact instructions in [`SUPPORT.md`](./SUPPORT.md). Do not put an email address, wallet details, or other personal information in a public GitHub issue.

## Security

Pip uses HTTPS, bearer-token authentication, server-side recommendation verification, and database row-level security. No system can guarantee absolute security. Report a suspected vulnerability using [`SECURITY.md`](./SECURITY.md).

## Children

Pip is not directed to children and should be used only by people permitted to hold and use the relevant credit-card products.

## Changes

Material changes to this notice will be committed here with a new effective date. Continuing to use a hosted release after a change means the current notice applies.

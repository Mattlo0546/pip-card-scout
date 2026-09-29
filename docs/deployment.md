# Deploy the Pip extension backend

Pip has no consumer web application. Vercel hosts only the authenticated JSON API used by the Chrome extension, while Supabase provides Auth and Postgres. Users install the extension from a GitHub release (or, later, the Chrome Web Store); they do not install it from Vercel.

## 1. Supabase

Use separate development, staging, and production projects. Link the CLI to the intended project, inspect the migration plan, then apply it:

```bash
supabase link --project-ref <project-ref>
supabase db push --linked --dry-run
supabase db push --linked
```

The dated catalogue migration is generated from `catalog/uk-credit-cards.json` and contains the published, source-backed release. Do not populate production from ad hoc fixtures.

In Supabase Auth:

- enable email/password authentication;
- require email confirmation in production;
- configure a real SMTP provider and verify confirmation and recovery delivery;
- configure CAPTCHA and abuse controls before allowing unrestricted public signup; and
- retain the anon and service-role keys only in the environments that need them.

Review the row-level-security policies and prove that two test accounts cannot read or mutate each other's wallet, settings, or history before promoting a schema change.

## 2. Vercel API

Create a Vercel project from this repository and configure these server-only environment variables:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-secret>
```

Never prefix the service-role key with `NEXT_PUBLIC_`, place it in the extension, or expose it in logs. Redact `Authorization` headers and request bodies in every monitoring product.

The API uses bearer tokens and no authentication cookies. It returns permissive CORS headers so separately installed unpacked extensions—with different generated `chrome-extension://` IDs—can call it. This does not grant database access: every private endpoint still requires a valid Supabase token, validates input, and applies RLS or server-side ownership checks. Keep managed rate limiting and abuse monitoring in front of public routes.

After deployment, verify:

```text
GET https://<api-host>/api/health
GET https://<api-host>/
```

The root must return service metadata, not a consumer HTML interface. Then run sign-up/sign-in, token refresh, two-user RLS, wallet CRUD, catalogue, recommendation, and CORS-preflight checks against staging.

## 3. Production extension

The same exact production API origin must appear in:

1. `extension/config.js` as `apiBaseUrl`;
2. `extension/manifest.json` under `host_permissions`; and
3. the manifest's extension-page CSP under `connect-src`.

The checked-in value is `https://pip-card-scout.vercel.app`. The extension must not contain a Supabase URL/key or allow localhost in a release package.

Run the complete release verification from a clean checkout:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run extension:package
```

Install the generated ZIP in Google Chrome by unzipping it and using **Load unpacked** at `chrome://extensions`. Verify account creation, email confirmation, sign-in, wallet add/remove/enable, token refresh, recommendation rendering, sign-out, and permanent account deletion on a real HTTPS checkout. Test both a rankable product and a catalogue-only product.

## 4. GitHub release

1. Confirm the manifest and package versions match.
2. Review the packaged file list and checksum under `dist/`.
3. Commit the source, push the release commit, and wait for CI to pass.
4. Tag the exact commit, for example `v1.0.0`.
5. Create a GitHub release from that tag and attach the generated extension ZIP.
6. Download the public asset once and repeat the Chrome unpacked-install smoke test.

Example, after substituting the exact generated filename:

```bash
git tag -s v1.0.0 -m "Pip Card Scout v1.0.0"
git push origin v1.0.0
gh release create v1.0.0 dist/<generated-extension.zip> \
  --title "Pip Card Scout v1.0.0" \
  --notes-file <release-notes.md>
```

Do not attach the repository source archive as the extension artifact: GitHub adds source archives automatically, and they include backend files that Chrome does not need.

## 5. Operations and broader-launch gates

- Review official issuer terms on a recurring schedule, alert on stale evidence, and require human approval before publishing a catalogue replacement.
- Keep recommendation inputs independent from referral or affiliate economics.
- Configure per-IP and per-user limits for authentication and mutation routes.
- Treat custom SMTP, verified Auth delivery, CAPTCHA, and signup abuse controls as hard gates for public self-service onboarding; Supabase's default email service is for limited testing only.
- Add monitoring with body/token redaction, backups, catalogue freshness alerts, incident response, and rollback procedures.
- Implement data export and automated retention enforcement, and regularly test the self-service account-deletion path.
- Complete Chrome Web Store privacy and financial-data disclosures before Store publication.
- Obtain appropriate payments/privacy legal review and confirm PCI scope before materially expanding usage.

See [`PRIVACY.md`](../PRIVACY.md), [`SECURITY.md`](../SECURITY.md), and [`SUPPORT.md`](../SUPPORT.md) for public operating commitments and known limitations.

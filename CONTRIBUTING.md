# Contributing to Pip

Thank you for helping improve Pip. Contributions should preserve its core boundary: recommend a card product without collecting payment credentials or controlling payment submission.

## Before opening a pull request

1. Open an issue for a substantial behaviour, schema, permission, or privacy change.
2. Create a focused branch from the current default branch.
3. Keep secrets, tokens, `.env` files, production user data, and real checkout details out of commits and test fixtures.
4. Run the complete verification suite:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run extension:package
```

Describe the user-visible change, security/privacy impact, test evidence, and any migration or deployment steps in the pull request.

## Catalogue contributions

A catalogue change must:

- identify the exact UK consumer credit-card product;
- cite a current, first-party issuer page or terms document;
- record the date the source was checked;
- separate recurring earn rates from introductory or personalised offers;
- preserve caps, thresholds, exclusions, activation requirements, fees, and redemption uncertainty; and
- remain `catalog_only` when Pip cannot model the terms deterministically with the state it holds.

Run `npm run catalog:normalize`, `npm run catalog:build`, and `npm run catalog:validate`. Do not publish scraped values without reviewing them against the issuer's current terms.

## Extension and privacy changes

New permissions, host access, data collection, remote services, page injection, or persistent storage require explicit justification and corresponding tests and documentation. Do not add payment-field selectors, PAN/CVC/expiry storage, automatic card filling, page-visible auth tokens, or a way for merchant scripts to trigger recommendations.

The production extension must remain locked to the exact HTTPS API host. Development origins must not enter the packaged artifact.

## Code and tests

- Prefer deterministic integer arithmetic for monetary values.
- Validate untrusted input at the API boundary.
- Preserve RLS and test cross-user isolation for schema or data-access changes.
- Add regression coverage for every bug fix.
- Keep recommendation ranking independent of referral or affiliate economics.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](./LICENSE).

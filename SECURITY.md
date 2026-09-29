# Security policy

## Supported version

Security fixes are applied to the latest release and the default branch. Older GitHub release ZIPs should be treated as unsupported after a newer release is published.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/Mattlo0546/pip-card-scout/security/advisories/new). Do not open a public issue for a vulnerability and do not include real card credentials, passwords, access tokens, or another person's data in a report.

Include:

- the affected version and component;
- clear reproduction steps;
- the security impact;
- logs or screenshots with tokens and personal data removed; and
- any suggested mitigation.

The maintainer will triage reports on a best-effort basis, keep confirmed issues private while a fix is prepared, and credit reporters when requested and safe to do so. There is currently no paid bug-bounty programme.

## Scope

High-priority issues include authentication or authorization bypasses, cross-user data access, token exposure, injection, unsafe extension permissions, payment-data collection, supply-chain compromise, and a way for a merchant page to read or fabricate private recommendations.

Pip intentionally does not handle full card numbers, CVC/CVV, expiry dates, or payment submission. Do not test with or submit those values.

Good-faith research must avoid privacy violations, service disruption, social engineering, automated account abuse, and access to data that is not yours. Stop testing and report immediately if you encounter another user's information.

# BFS standard — Security Policy

## Reporting a vulnerability
Do not open a public issue. Use GitHub's **Security > Report a vulnerability** (private advisory) on this repo, or call (346) 298-0045. Expect a reply within 3 business days.

## Data handling
This project may process personal or financial data. Rules:
- **In transit:** HTTPS only. HSTS (`max-age=31536000; includeSubDomains`) on every HTTPS response. No cleartext HTTP, including on Android (`usesCleartextTraffic=false` + `network_security_config`).
- **At rest:** tokens and PII encrypted (AES-256-GCM with a random 96-bit IV per message, or Android Keystore / EncryptedSharedPreferences). Keys come from environment secrets, never from the repo.
- **Logs:** never log tokens, auth codes, cookies, emails, account numbers or file contents. Redact before logging.
- **Secrets:** never commit `.env*`, keystores (`*.jks`), or OAuth property files. Rotate any secret that ever reaches git history.

## Repository protocol (owner: apply in GitHub Settings)
- **Secret scanning + push protection:** Settings > Code security > enable *Secret scanning* and *Push protection* (repo setting, not a file).
- **Dependabot alerts and security updates:** enable in the same page; version updates are configured in `.github/dependabot.yml`.
- **CodeQL:** `.github/workflows/codeql.yml` (where code exists). **Secret/malware scan:** `.github/workflows/security.yml` runs gitleaks over full history; npm projects also run `npm ci --ignore-scripts`, `lockfile-lint` (HTTPS + integrity) and `npm audit`.
- **Branch protection for `main`:** require a pull request with 1 review, require the `security` and `codeql` checks, require linear history, block force-pushes and deletion, require signed commits, include administrators.
- **Dependencies:** commit the lockfile, install with `npm ci`, pin GitHub Actions to major versions (pin to commit SHA for release workflows), review Dependabot PRs before merging.
- **Releases:** sign tags (`git tag -s`), sign Android APKs with the offline release key (`apksigner`, v2+ scheme) and publish the SHA-256 checksum next to each artifact. Keep keystores off git and backed up offline.

## Edge / firewall recommendations (not applied automatically)
If deployed behind Vercel, Netlify or Cloudflare: enable the platform WAF/bot protection, add a rate-limit rule on `/api/*` and `/auth/*` (for example 120 requests/min per IP), block request bodies over 64 KB, and keep the security headers below.

## Cloud Dupe Cleaner specifics (audit 2026-10-14)
- Server: helmet CSP/HSTS (HSTS when `PUBLIC_BASE_URL` is https), `express.json` 32 KB body cap, signed HttpOnly SameSite=Lax session cookie (`Secure` on https), CSRF token on mutating routes, per-IP rate limit on `/auth` and `/api` (bounded memory).
- Token vault: AES-256-GCM, random 12-byte IV, 16-byte tag checked, 32-byte key from `TOKEN_ENCRYPTION_KEY`.
- Android: `allowBackup=false`, cleartext disabled, tokens in EncryptedSharedPreferences (Keystore AES256-GCM master key), OAuth PKCE + constant-time `state` check, exported OAuthRedirectActivity accepts only its own schemes.
- Certificate pinning is intentionally **not** used: Google/Dropbox rotate certificates and pinning would break sign-in. System trust anchors only; user-installed CAs are not trusted.
- Behind a reverse proxy, set `trust proxy` to the proxy hop count, otherwise all clients share one rate-limit bucket.

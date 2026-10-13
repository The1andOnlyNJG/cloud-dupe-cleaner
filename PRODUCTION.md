# Production configuration

Demo mode needs none of this. Set these only when the web app should use real accounts, or when you sign a release APK. Do not commit `.env`, `local.properties`, `*.jks`, or the keystore password file.

## Web server environment

| Variable | Required in production | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `MOCK_PROVIDERS` | yes | `true` or `false`. Production refuses to start if this is unset. |
| `PERSIST_TOKENS` | yes | `true` or `false`. Must be explicit in production. |
| `SESSION_SIGNING_KEY` | yes | 32 bytes, base64. `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY` | when `PERSIST_TOKENS=true` | 32 bytes, base64. A different value from the session key. |
| `PUBLIC_BASE_URL` | yes for live OAuth | Public `https://` origin, no path, query, user, or password. |
| `HOST` | no | `127.0.0.1` (default), `localhost`, or `0.0.0.0` behind a TLS proxy. |
| `PORT` | no | Default `3000`. |
| `GOOGLE_CLIENT_ID` | live Google only | Server-side. |
| `GOOGLE_CLIENT_SECRET` | optional | Omit for a public PKCE client. Never send it to the browser. |
| `DROPBOX_CLIENT_ID` | live Dropbox only | Server-side. |
| `DROPBOX_CLIENT_SECRET` | optional | Omit when PKCE is enough. |
| `MICROSOFT_CLIENT_ID` | live OneDrive only | Server-side. |
| `MICROSOFT_CLIENT_SECRET` | optional | Omit for a public PKCE client. |

Generate keys on the server. Do not reuse `dev-secret-change-me` or any example string.

## HTTPS

- Serve the site with TLS. Set `PUBLIC_BASE_URL` to that `https://` origin.
- The session cookie is marked `Secure` only when `PUBLIC_BASE_URL` starts with `https://`.
- Register each OAuth redirect as `https://YOUR_HOST/auth/{dropbox|onedrive|gdrive|gphotos}/callback`. The app allows only those exact URLs.
- Keep `HOST=127.0.0.1` when a reverse proxy on the same machine terminates TLS. Use `0.0.0.0` only if the proxy is on another host and the app port is not exposed to the internet.
- Do not turn on token persistence until `TOKEN_ENCRYPTION_KEY` is set. The ciphertext file is `data/sessions.enc` and should be readable only by the service account.

## Android release signing

The release build reads the keystore from the environment, a Gradle property, or `android/local.properties`, in that order. `local.properties` and `*.jks` are gitignored.

| Name | Example | Meaning |
| --- | --- | --- |
| `CDC_STORE_FILE` | `/path/to/cdc-release.jks` | Keystore path |
| `CDC_STORE_PASSWORD` | random | Keystore password |
| `CDC_KEY_ALIAS` | `cdc-release` | Key alias |
| `CDC_KEY_PASSWORD` | random | Key password |

Pass them as environment variables or as the same keys in `android/local.properties`. Then run `:app:assembleRelease`. Without all four, the release build is unsigned.

A later Google Android OAuth client for this app needs package name `com.njg.clouddupecleaner` and the SHA-1 of the release signing certificate. Put the consent screen in Testing and add test users before any real Google sign-in.

## Android OAuth client IDs

Public client IDs are read at build time from the environment or from `android/local.properties`. They are written into `BuildConfig` and are not committed. Leave them unset to build sample mode.

| Name | Meaning |
| --- | --- |
| `CDC_GOOGLE_CLIENT_ID` | Google Android OAuth client ID. No client secret. |
| `CDC_DROPBOX_APP_KEY` | Dropbox app key. PKCE, no secret. |

Google sign-in uses the reverse client ID redirect `com.googleusercontent.apps.<id>:/oauth2redirect`. Dropbox uses `clouddupecleaner://oauth` and `token_access_type=offline`. OneDrive is not wired up.

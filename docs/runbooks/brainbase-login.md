# brainbase login

`brainbase login` signs a person in from the terminal with the Device Code Flow of their Brainbase API. The CLI stores the person token on the machine, and hooks or commands get a token from `getAccessToken` (`@unson/brainbase-mcp/brainbase-login`) instead of a pasted environment variable.

The package has no default server. Name your own API once:

```sh
brainbase login --server https://<your-brainbase-api>
```

The command prints a URL and a code. Open the URL, sign in with your usual login, and approve. The CLI then saves the login and tells the server it has stored it, so the server does not hand the same token out again.

```sh
brainbase login:status   # server, token expiry, whether it can renew; never prints the token
brainbase logout         # removes the saved login from this machine
```

## What is stored

`~/.brainbase/credentials.json` (or `BRAINBASE_CREDENTIALS_FILE`, or `--credentials <path>`), mode 0600 in a 0700 directory:

- `login_id`: a random id of this login. A renewal keeps it; a new login replaces it.
- `server_url`: the API origin. It is checked again on every read: a saved plain-HTTP server (other than localhost) makes the file unusable.
- `access_token`: the person JWT. It is the same token the Web login issues.
- `refresh_token`: present when the server issues one.
- `expires_at`: taken from the token's `exp`, or from `expires_in`.

The file is written to a temporary file, flushed to disk, renamed, and the directory is flushed too. The receipt goes to the server only after that.

`getAccessToken` returns the stored token while it has more than a minute left. Otherwise it calls `POST /api/auth/refresh`. A login without a refresh token is used until it actually expires.

Login, logout and the write-back of a renewal take a lock file next to the credentials (`credentials.json.lock`). A renewal writes back only when the file still holds the same login (same `login_id` and server). If a logout or another login happened while the renewal was in flight, nothing is written and the call fails with `login_changed`. When two processes renew the same login at once and one loses, it uses the token the other stored. A token from a different login is never handed out.

## Server contract

- `POST /api/auth/device/code` with `{ code_verifier, receipt_required: true }` → `{ device_code, user_code?, verification_uri, verification_uri_complete?, expires_in, interval }`
- `POST /api/auth/device/token` with `{ device_code, code_verifier }` → `{ access_token, refresh_token?, expires_in?, receipt_token? }`, or 400 `authorization_pending` / `slow_down` / `expired_token` / `invalid_grant`, or 403 `access_denied`; a 5xx is retried until the code expires
- `POST /api/auth/device/received` with `{ device_code, receipt_token }`
- `POST /api/auth/refresh` with `{ refresh_token }` → `{ token, refresh_token? }`; 503 means try again later

Only HTTPS servers are accepted, plus HTTP on localhost for local development.

## Errors

Failures carry a `login_*` code: `login_missing`, `login_expired` (run `brainbase login` again), `login_refresh_unavailable` (retry later), `login_denied`, `login_timeout`, `login_device_flow_unavailable`, `login_server_transport_unsafe`, `login_credentials_invalid`, `login_changed` (run the command again), `login_busy` (another process holds the lock; retry).

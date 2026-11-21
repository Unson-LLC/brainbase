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

The file is written to a temporary file, flushed to disk, and renamed. Then its directory is flushed, and so is each directory above it, up to and including the first one that this user does not own (for `~/.brainbase/credentials.json`: `~/.brainbase`, `~`, `/home`). This happens on every save, even when the directories already existed: another process may have just created them, or an earlier save may have failed to flush them. The receipt goes to the server only after all of that succeeded. An I/O error while flushing fails the login with `login_save_failed` and sends no receipt. On a platform or file system that cannot flush directories (Windows, some network file systems), the login is kept but no receipt is sent; the server then lets the code expire on its own.

`getAccessToken` returns the stored token while it has more than a minute left. Otherwise it gets a CSRF token from `GET /api/csrf-token` and calls `POST /api/auth/refresh` with it, the same way the organization client does. The API keeps CSRF tokens in each server process, so a refusal of the CSRF token is asked once more with a new one, and otherwise reported as `login_refresh_unavailable` (the refresh token still works). A login without a refresh token is used until it actually expires.

Login, logout and renewal take a lock file next to the credentials (`credentials.json.lock`). A renewal holds it from its request to its write-back. A logout or another login started meanwhile waits for the renewal and then wins. A second renewal waits too, then uses the token the first one stored without calling the server. Under the lock, a renewal goes ahead only when the file still holds the same login (same `login_id` and server); otherwise it fails with `login_changed`. A token from a different login is never handed out.

The lock file holds a random id of its holder, its process id and the host name. It is created with that content in one step, and only its holder removes it. Another process removes it only when the holder's process no longer runs on this machine, so a holder keeps the lock for as long as it works, through every read, write and removal of the credentials file. Before removing a dead holder's lock, a process takes a takeover lock named after what it read, then reads the lock again and removes it only when it is unchanged; two processes taking over the same dead lock never remove the new lock of a third. A lock held from another machine (a shared home directory) is never taken over: the waiter fails with `login_busy` and names the host. A waiter gives up after 35 seconds with `login_busy`. Right before replacing the credentials file, a write checks the lock still carries its id; if something outside brainbase replaced it, it writes nothing and fails with `login_lock_lost`.

While polling, the CLI checks the code's expiry again after each wait, so a longer wait after `slow_down` does not send a request past the expiry.

## Server contract

- `POST /api/auth/device/code` with `{ code_verifier, receipt_required: true }` → `{ device_code, user_code?, verification_uri, verification_uri_complete?, expires_in, interval }`
- `POST /api/auth/device/token` with `{ device_code, code_verifier }` → `{ access_token, refresh_token?, expires_in?, receipt_token? }`, or 400 `authorization_pending` / `slow_down` / `expired_token` / `invalid_grant`, or 403 `access_denied`; a 5xx is retried until the code expires
- `POST /api/auth/device/received` with `{ device_code, receipt_token }`
- `GET /api/csrf-token` with `x-session-id` → `{ token }`; a 404 means the server has no CSRF check, and the refresh goes without these headers
- `POST /api/auth/refresh` with `{ refresh_token }` and the headers `x-session-id` and `x-csrf-token` → `{ token, refresh_token? }`; 503, or 403 with a CSRF message, means try again later

The device-flow paths (`/api/auth/device/*`) need no CSRF token.

Only HTTPS servers are accepted, plus HTTP on localhost for local development.

## Errors

Failures carry a `login_*` code: `login_missing`, `login_expired` (run `brainbase login` again), `login_refresh_unavailable` (retry later), `login_denied`, `login_timeout`, `login_device_flow_unavailable`, `login_server_transport_unsafe`, `login_credentials_invalid`, `login_changed` (run the command again), `login_busy` (another process holds the lock; retry), `login_lock_lost` (another process took the lock over; run the command again), `login_save_failed` (the login could not be flushed to disk; run `brainbase login` again).

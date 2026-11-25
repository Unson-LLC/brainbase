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

The file is written to a temporary file, flushed to disk, and renamed. If writing or flushing the temporary file fails, it is removed, so no copy of the login is left behind. Then its directory is flushed, and so is each directory above it, up to and including the first one that this user does not own (for `~/.brainbase/credentials.json`: `~/.brainbase`, `~`, `/home`). This happens on every save, even when the directories already existed: another process may have just created them, or an earlier save may have failed to flush them. The receipt goes to the server only after all of that succeeded. An I/O error while flushing fails the login with `login_save_failed` and sends no receipt. On a platform or file system that cannot flush directories (Windows, some network file systems), the login is kept but no receipt is sent; the server then lets the code expire on its own.

The directory of the `--credentials` path is resolved the way the OS resolves it (symbolic links followed, then `..` applied) before anything is written, removed or flushed, so the change and the flush go to the same, real directory. The file itself must not be a symbolic link: reading would follow it while a save or logout would replace or remove only the link, leaving a second copy of the tokens. Every command refuses such a path with `login_credentials_path_symlink` and changes nothing; pass the real file with `--credentials`. A relative path and a path like `link/../x` are handled the same way: the directories above the working directory are flushed too, and `link/..` is not dropped as a string. Every spelling of the same file uses the same lock.

The file name of a `--credentials` path may not end in `.lock`, `.replacing`, `.removing` or `.probe-<hex>` (case ignored). brainbase keeps those names, next to every saved login, for its lock and for a login moved aside while saving or logging out. Every command refuses such a path with `login_credentials_path_invalid` and changes nothing. A save or logout that stopped half way is finished or rolled back when the lock is next taken. A file at `.replacing` or `.removing` that is no saved brainbase login is left where it is, neither moved nor deleted, and the next save or logout that needs that name fails with `login_changed`.

`brainbase login`, `brainbase login:status` and `brainbase logout` accept only their own options (`--credentials`, and `--server` for `login`), each once and with a value written after a space. Anything else stops the command with exit code 1 before the save path is decided: a misspelt option such as `--credntials`, an option of another command, a word or path without an option name, or the same option twice. Nothing is read, removed or sent, so a typo never makes logout fall back to the default path and delete the default login.

`brainbase logout` removes the file only when it is a saved brainbase login (one that carries brainbase's `schema_version`, usable or not). Any other file at that path, such as another tool's settings after a mistyped `--credentials`, is left as it is and logout exits with 1 (`login_credentials_unrecognized`); a file it cannot read is left too (`login_credentials_unreadable`). It removes the file and flushes its directory while it still holds the lock, and says the login was removed only after that. An I/O error while flushing exits with 1 and does not say the login was removed; run `brainbase logout` again. Where directories cannot be flushed, the file is removed and a warning says the old login may come back after a power loss.

`getAccessToken` returns the stored token while it has more than a minute left. Otherwise it gets a CSRF token from `GET /api/csrf-token` and calls `POST /api/auth/refresh` with it, the same way the organization client does. The API keeps CSRF tokens in each server process, so a refusal of the CSRF token is asked once more with a new one, and otherwise reported as `login_refresh_unavailable` (the refresh token still works). A 429 or any 5xx from the refresh, or a 2xx answer whose body is cut off before it is read, is reported the same way: the saved login stays, and a later try may succeed. Only a refusal of the refresh token itself asks for a new login (`login_expired`). A login without a refresh token is used until it actually expires.

Login, logout and renewal take a lock file next to the credentials (`credentials.json.lock`). A renewal holds it from its request to its write-back. A logout or another login started meanwhile waits for the renewal and then wins. A second renewal waits too, then uses the token the first one stored without calling the server. Under the lock, a renewal goes ahead only when the file still holds the same login (same `login_id` and server); otherwise it fails with `login_changed`. A token from a different login is never handed out.

The lock file holds a random id of its holder, its process id, the host name, and when that process started (on Linux the boot id and the start time from `/proc/<pid>/stat`; on macOS and other systems the start time from `ps`; on Windows nothing). It is created with that content in one step, and only its holder removes it. Another process removes it only when the holder's process no longer runs on this machine: either nothing runs under that process id, or a process that started at another time does (the id was reused after a crash or a reboot). A lock whose start cannot be read is treated as held, so a holder keeps the lock for as long as it works, through every read, write and removal of the credentials file. Before removing a dead holder's lock, a process takes a takeover lock named after what it read, then reads the lock again and removes it only when it is unchanged; two processes taking over the same dead lock never remove the new lock of a third. A lock held from another machine (a shared home directory) is never taken over: the waiter fails with `login_busy` and names the host. A waiter gives up after 65 seconds with `login_busy`: a renewal may make four requests under the lock (a CSRF token and the refresh, asked once more after a CSRF refusal), each up to 15 seconds. On Windows the start of a process is not recorded, so a lock is taken over only when nothing runs under its process id. Recovering a lock whose process id Windows has given to another program is not supported: the waiter fails with `login_busy`, and the message names the lock file to remove if no brainbase command is running. Right before replacing the credentials file, a write checks the lock still carries its id; if something outside brainbase replaced it, it writes nothing and fails with `login_lock_lost`.

The lock is created with a hard link, so the folder of the credentials file must be on a file system with hard links (APFS, ext4, NTFS and most others; not exFAT or FAT32). `brainbase login` checks this before it asks the server for a code, so nobody approves a login that cannot be saved; logout and renewal fail the same way. Each fails with `login_storage_unsupported` and changes nothing.

While polling, the CLI checks the code's expiry again after each wait, so a longer wait after `slow_down` does not send a request past the expiry.

## Move a trial login saved under a reserved name

This applies if an earlier trial build saved your login under a name ending in `.lock`, `.replacing`, `.removing`, or `.probe-` followed by one or more hexadecimal digits, regardless of case. The updated CLI refuses that path with `login_credentials_path_invalid`.

1. Close Claude Code and stop other hooks and CLI commands that use the same credentials directory, including on other machines if it is shared. A file such as `work.json.removing` can also be a recovery file for `work.json`. Work only on the file you explicitly chose for the trial login. If you cannot tell which file it is, leave it in place and ask the trial administrator before running commands against either path.
2. Choose an unused, non-reserved filename in the same private directory, such as `work-trial.json`. Use a destination with no existing file, symlink, or adjacent lock or recovery files.
3. Choose one of these two options.

   - If you still have the trial build that accepted the old path, run `brainbase logout --credentials "$OLD"` with that build and confirm it succeeds. Install the updated build and run `brainbase login --server "$API_URL" --credentials "$NEW"`. Use the original API and account. Here `OLD` and `NEW` are the absolute paths you chose, and `API_URL` is your API URL.
   - If you have already updated or want to keep the saved login, move the confirmed regular file to the new name in the same directory. Keep its permissions at 0600 and the directory at 0700. On macOS or Linux, use `mv -n "$OLD" "$NEW"` after checking that the destination is unused. Confirm that the old path is gone and the new path holds the file before continuing. If the old file has already disappeared, leave any recovery files in place and sign in again at the new path.
4. Update every `--credentials` argument and set `BRAINBASE_CREDENTIALS_FILE` to the new absolute path in the environment that starts your hooks. Run `brainbase login:status --credentials "$NEW"` and check the expected server and expiry. If the login has expired, sign in again at the new path. Restart Claude Code or the other hook runner and check that a test event reaches the expected project.

## Server contract

- `POST /api/auth/device/code` with `{ code_verifier, receipt_required: true }` → `{ device_code, user_code?, verification_uri, verification_uri_complete?, expires_in, interval }`
- `POST /api/auth/device/token` with `{ device_code, code_verifier }` → `{ access_token, refresh_token?, expires_in?, receipt_token? }`, or 400 `authorization_pending` / `slow_down` / `expired_token` / `invalid_grant`, or 403 `access_denied`; a 5xx is retried until the code expires
- `POST /api/auth/device/received` with `{ device_code, receipt_token }`
- `GET /api/csrf-token` with `x-session-id` → `{ token }`; a 404 means the server has no CSRF check, and the refresh goes without these headers
- `POST /api/auth/refresh` with `{ refresh_token }` and the headers `x-session-id` and `x-csrf-token` → `{ token, refresh_token? }`; 429, any 5xx, or 403 with a CSRF message, means try again later

The device-flow paths (`/api/auth/device/*`) need no CSRF token.

Only HTTPS servers are accepted, plus HTTP on localhost for local development.

## Errors

Failures carry a `login_*` code: `login_missing`, `login_expired` (run `brainbase login` again), `login_refresh_unavailable` (retry later), `login_denied`, `login_timeout`, `login_device_flow_unavailable`, `login_server_transport_unsafe`, `login_credentials_invalid`, `login_credentials_path_invalid`, `login_credentials_path_symlink`, `login_credentials_unrecognized`, `login_credentials_unreadable` (logout left the file as it is; check `--credentials`), `login_changed` (run the command again), `login_busy` (another process holds the lock; retry), `login_lock_lost` (another process took the lock over; run the command again), `login_save_failed` (the login could not be flushed to disk; run `brainbase login` again), `login_storage_unsupported` (the folder of the credentials file has no hard links; pass `--credentials` with a path on another file system).

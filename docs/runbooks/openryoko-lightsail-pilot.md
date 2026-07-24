# OpenRyoko Lightsail pilot

## Scope and current deployment

- Dedicated AWS Lightsail instance only. Do not install anything on the
  `bb.unson.jp` instance.
- Ubuntu 24.04, 4 GB plan, Tokyo (`ap-northeast-1`), static IP.
- Inbound firewall: TCP 22 only. Port 7777 remains bound to `127.0.0.1`.
- `mana` Lambda remains the Slack receiving/notification layer and is not
  modified by this pilot.
- Graph SSOT remains the canonical source of organizational facts. Ryoko memory
  is working context, not a second SSOT.

The first pilot instance was created as `openryoko-pilot-20260724`.
Its connection material is held in Infisical; do not commit IPs, private keys,
OAuth tokens, or Slack tokens here.

## Rebuild

1. Create a fresh Lightsail Ubuntu 24.04 instance with the 4 GB plan, attach a
   static IP, and allow inbound TCP 22 only.
2. Run `sudo scripts/openryoko/bootstrap-instance.sh`.
3. In Infisical project `OpenRyoko`, production environment, provision a
   protected file containing:

   ```text
   CLAUDE_CODE_OAUTH_TOKEN=<Infisical-injected value>
   ```

   Install it as `/home/ryoko/.config/openryoko/environment`, owned by
   `ryoko:ryoko`, mode `600`. Never print or copy the value into a command log.
4. Complete Claude Code's one-time interactive screens as `ryoko`:

   ```bash
   sudo -u ryoko -H bash -lc \
     'source "$HOME/.nvm/nvm.sh"; set -a; source "$HOME/.config/openryoko/environment"; set +a; claude --dangerously-skip-permissions'
   ```

   Select the theme, then accept bypass-permissions mode. This is acceptable
   only on this dedicated pilot VM.
5. Apply runtime configuration:

   ```bash
   sudo SLACK_ALLOW_USER_ID=U07LNUP582X \
     scripts/openryoko/configure-runtime.sh
   ```

The wrapper installed by `configure-runtime.sh` is required for OpenRyoko
2026.7.10: its Interactive PTY strips every `CLAUDE_CODE_*` variable before
spawning Claude. The wrapper reloads the mode-600 Infisical projection without
embedding or logging the token.

## Slack pilot

Create a dedicated Slack app; never reuse mana's bot token. Use the App
Manifest shown by the installed OpenRyoko Settings page, install it only to the
Unson workspace, and add it only to the single pilot channel. Store the bot/app
tokens in Infisical before projecting them to the runtime environment.

The mandatory drive boundary is:

- `connectors.slack.allowFrom = ["U07LNUP582X"]`
- channel messages require a mention
- IM and MPIM are disabled
- external sends are limited to the pilot channel

Do not start the connector with an empty `allowFrom`.

## UI and operations

Open the UI only through an SSH tunnel:

```bash
ssh -i /path/to/key.pem -L 7777:127.0.0.1:7777 ubuntu@INSTANCE_IP
```

Then browse to `http://127.0.0.1:7777`.

Health and recovery checks:

```bash
sudo systemctl status openryoko.service
sudo journalctl -u openryoko.service --since today
curl --fail http://127.0.0.1:7777/
sudo reboot
# reconnect, then:
systemctl is-enabled openryoko.service
systemctl is-active openryoko.service
```

## MCP

Configure Graph SSOT and NocoDB in the `ryoko` user's Claude Code MCP scope.
Inject credentials from Infisical. Verify with a Slack mention that reads a
known Graph fact through `https://bb.unson.jp`; a successful HTTP check alone
is not task-level proof. Do not write pilot observations back as facts unless
they pass the normal Graph curation flow.

## Organization

Keep the pilot at the default single employee. To expand later, add YAML files
under `~/.ryoko/org/` with `rank`, `persona`, and `reportsTo`. Use a separate
Ryoko instance per trust boundary. Do not use `sshHost` in this pilot because
remote employees fall back to `claude -p` and may change the billing path.
Docker isolation is outside this pilot.

## Cron smoke test

Register one minimal job in `~/.ryoko/cron/jobs.json`, restart OpenRyoko after
editing, and inspect both journal completion and the session output. The first
pilot smoke test returned exactly `OPENRYOKO_CRON_OK`. Leave channel delivery
disabled until Slack installation is complete.

## Evaluation ledger

Use a dedicated NocoDB table named `OpenRyoko Pilot Runs`; this is operational
measurement data, not Graph facts. Record one row per task or scheduled run:

- started_at, completed_at, source (`mention` or `cron`)
- session_id, task_type, completed
- human_interventions
- proposal_created, proposal_adopted
- rate_limited, rate_limit_kind
- failure_category, evidence_url, notes

Weekly calculations:

- task completion rate
- average human interventions per completed task
- cron success rate
- adopted proposals / proposals created; below 80% is a quality signal
- Max rate-limit collisions with Sato's direct usage

Run the pilot for two to four weeks. Missing or unavailable evidence is
`未確認`, never zero or success.

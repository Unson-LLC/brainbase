# OpenRyoko Lightsail pilot

> Current state: constrained pilot. Slack, PTY, Graph/Noco read access, systemd,
> cron, the Phase 1 `draft_only` negative test, and Brainbase Run Receipt
> delivery have been exercised. Do not widen access until the two-to-four-week
> evaluation has enough evidence.

## Scope and current deployment

- Dedicated AWS Lightsail instance only. Do not install anything on the
  `bb.unson.jp` instance.
- Ubuntu 24.04, 4 GB plan, Tokyo (`ap-northeast-1`), static IP.
- Inbound firewall: TCP 22 only. Port 7777 remains bound to `127.0.0.1`.
- `mana` Lambda remains the Slack receiving/notification layer and is not
  modified by this pilot.
- Graph SSOT remains the canonical source of organizational facts. Ryoko memory
  is working context, not a second SSOT.
- Gateway source is the thin
  [`Unson-LLC/OpenRyoko`](https://github.com/Unson-LLC/OpenRyoko) fork with
  `rsensui2/OpenRyoko` retained as upstream. Pin a reviewed fork commit before
  applying fork-specific behavior; do not install an unrecorded moving head.

The first pilot instance was created as `openryoko-pilot-20260724`.
Its connection material is held in Infisical; do not commit IPs, private keys,
OAuth tokens, or Slack tokens here.

## Rebuild

1. Create a fresh Lightsail Ubuntu 24.04 instance with the 4 GB plan, attach a
   static IP, and allow inbound TCP 22 only.
2. Run `sudo scripts/openryoko/bootstrap-instance.sh`.

   The script builds the public `Unson-LLC/OpenRyoko` fork at its recorded full
   commit SHA. It does not install a moving npm release. To advance the runtime,
   review the fork change first, then update `OPENRYOKO_REF` in the script. A
   one-off rebuild may override it explicitly:

   ```bash
   sudo OPENRYOKO_REF=<reviewed-full-commit-sha> \
     scripts/openryoko/bootstrap-instance.sh
   ```
3. In Infisical project `OpenRyoko`, production environment, provision two
   protected files. The Claude-only file contains:

   ```text
   CLAUDE_CODE_OAUTH_TOKEN=<Infisical-injected value>
   ```

   Install it as `/home/ryoko/.config/openryoko/claude-environment`. The
   gateway-only file contains:

   ```text
   OPENRYOKO_SLACK_APP_TOKEN=<Infisical-injected value>
   OPENRYOKO_SLACK_BOT_TOKEN=<Infisical-injected value>
   ```

   Install it as `/home/ryoko/.config/openryoko/gateway-environment`. Both
   files must be regular files owned by `ryoko:ryoko`, mode `600`. Never print
   or copy a value into a command log. The files reduce automatic inheritance;
   the pinned runtime and Claude wrapper also remove Slack credentials before
   starting Claude.
4. Complete Claude Code's one-time interactive screens as `ryoko`:

   ```bash
   sudo -u ryoko -H bash -lc \
     'source "$HOME/.nvm/nvm.sh"; set -a; source "$HOME/.config/openryoko/claude-environment"; set +a; claude --dangerously-skip-permissions'
   ```

   This invocation is only for Claude Code's local first-run screens. The
   gateway runtime is configured separately and must remain in `plan` mode.
5. Apply runtime configuration:

   ```bash
   sudo SLACK_ALLOW_USER_ID=U07LNUP582X \
     scripts/openryoko/configure-runtime.sh
   ```

The wrapper installed by `configure-runtime.sh` is required for OpenRyoko
2026.7.10: its Interactive PTY strips every `CLAUDE_CODE_*` variable before
spawning Claude. The wrapper reloads only the Claude OAuth projection, removes
any inherited `OPENRYOKO_SLACK_*` values, and never embeds or logs a token. The
pinned runtime also strips Slack credentials on Claude child-process paths.
Slack credentials are resolved from `OPENRYOKO_SLACK_*` and removed from
`config.yaml`. The same script enforces:

- `gateway.host = 127.0.0.1`
- one explicit Slack `allowFrom` user
- mention-only channel handling, with IM and MPIM disabled
- Interactive PTY enabled
- `engines.claude.interactivePermissionMode = plan`

After each runtime change, create a disposable web session that asks Claude to
write a unique sentinel file. The session may complete with a plan, but the
sentinel must remain absent. Record the session ID and result without storing
the prompt or transcript.

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
sudo systemctl status openryoko-run-receipt.timer
sudo systemctl status openryoko-pilot-health.timer
sudo journalctl -u openryoko.service --since today
sudo journalctl -u openryoko-run-receipt.service --since today
sudo journalctl -u openryoko-pilot-health.service --since today
curl --fail http://127.0.0.1:7777/
sudo -u ryoko -H /home/ryoko/bin/openryoko-pilot-health
sudo reboot
# reconnect, then:
systemctl is-enabled openryoko.service
systemctl is-active openryoko.service
```

The health check emits one metadata-only JSON object. It fails when the gateway
or receipt timer is inactive, the local gateway is unreachable, a dead-letter
exists, or the oldest outbox item has remained undelivered for more than five
minutes. It also records disk use and available memory. It never reads receipt
payloads, prompts, transcripts, or secrets. A systemd timer runs it every five
minutes; a failed unit or journal entry is an incident signal, not proof that a
Slack notification was delivered.

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

## Pilot task catalog

Start with only the three read/draft-only task types defined in
[`docs/internal/openryoko-pilot-task-catalog.md`](../internal/openryoko-pilot-task-catalog.md):

1. Graph-backed internal research
2. decision-preparation memo
3. meeting or Slack follow-up structuring

Do not add external sends, Graph writes, deployments, purchases, or Mana M-job
migration to the first task set.

## Evaluation ledger

The authority is Brainbase `run_receipt.v1` plus Decision Events, as specified
in `docs/specs/story-ai-employee-node-phase1-spec.md`. Run Receipt delivery from
the pilot instance to project `unson` was proven on 2026-07-25 JST. Do not
create a second canonical ledger in NocoDB. Until Slack disposition events are
wired, record adoption, editing, and human-intervention observations as
explicitly temporary pilot annotations linked to the canonical run:

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

## Canonical run receipts

The Brainbase release containing `source.type=openryoko` is live. Project a
separate mode-600 file at
`/home/ryoko/.config/openryoko/run-receipt.env` with:

```text
BRAINBASE_PROJECT_ID=unson
BRAINBASE_RUN_RECEIPT_INGEST_URL=<server-to-server ingest URL>
BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN=<Infisical-injected value>
```

Do not reuse the Claude OAuth token or expose this file to OpenRyoko sessions.
Install the one-minute collector only after all three values exist:

```bash
sudo scripts/openryoko/install-run-receipt.sh
systemctl status openryoko-run-receipt.timer
journalctl -u openryoko-run-receipt.service --since today
```

The first poll establishes a baseline and emits no historical receipts.
Subsequent terminal transitions enqueue metadata-only `run_receipt.v1`
records. Delivery failure retains the receipt in a local outbox; bounded
failures move it to dead-letter rather than reporting success. Prompts,
messages, raw logs, and transcripts are never copied.

### Dead-letter handling

Treat every dead-letter as an incident. Do not blindly replay or delete it.

1. List filenames and safe metadata without printing the receipt body:

   ```bash
   sudo -u ryoko -H find \
     /home/ryoko/.local/state/openryoko-run-receipt/dead-letter \
     -maxdepth 1 -type f -name '*.json' -printf '%f\n'
   ```

2. Determine the cause from the collector journal and Brainbase health. Common
   causes are an inaccessible `project_id`, expired service token, rejected
   contract, or prolonged network failure.
3. Correct the cause first. For a retryable receipt, move the exact reviewed
   file back to `outbox`; never use a wildcard:

   ```bash
   sudo -u ryoko -H mv \
     /home/ryoko/.local/state/openryoko-run-receipt/dead-letter/<exact-file>.json \
     /home/ryoko/.local/state/openryoko-run-receipt/outbox/<exact-file>.json
   sudo systemctl start openryoko-run-receipt.service
   ```

4. If the receipt is permanently invalid, move the exact file to `resolved/`
   after recording the reason and canonical run reference in the incident
   record. `resolved/` is retained for audit and is not retried:

   ```bash
   sudo -u ryoko -H mv \
     /home/ryoko/.local/state/openryoko-run-receipt/dead-letter/<exact-file>.json \
     /home/ryoko/.local/state/openryoko-run-receipt/resolved/<exact-file>.json
   ```

5. Confirm the outbox and dead-letter counts are zero and run:

   ```bash
   sudo -u ryoko -H /home/ryoko/bin/openryoko-pilot-health
   ```

The first pilot dead-letter used the obsolete `brainbase` project while the
service token was scoped to `unson`; it is permanently invalid and must be
resolved rather than replayed.

## Incident order

Use this order to avoid changing state before the failure is understood:

1. Run `openryoko-pilot-health` and capture its metadata-only output.
2. Check `openryoko.service`, then the local gateway.
3. Check the receipt timer, outbox count, and dead-letter count.
4. Check Claude authentication and Max rate-limit messages without printing
   credentials.
5. Check public Brainbase health and the canonical inbox.
6. Restart only the failed unit. Do not reboot the instance as the first step.
7. Re-run one disposable read-only canary and confirm its Run Receipt.

Until an authenticated pilot-channel alert sender is implemented, systemd and
journal are the confirmed alert surface. External alert delivery is
`未実装`, not successful.

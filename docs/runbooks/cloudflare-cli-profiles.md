# Cloudflare CLI profiles

Use `scripts/cloudflare-profile.mjs` when operating more than one Cloudflare
organization from the same machine. It selects a Wrangler named-auth profile and
checks the intended Account ID before starting Wrangler.

## One-time setup

Wrangler 4 or newer is required because the wrapper uses named authentication
profiles.

```bash
mkdir -p ~/.brainbase/cloudflare/profiles
chmod 700 ~/.brainbase/cloudflare/profiles
cp scripts/setup/cloudflare-profile.example.json \
  ~/.brainbase/cloudflare/profiles/unson.json
cp scripts/setup/cloudflare-profile.example.json \
  ~/.brainbase/cloudflare/profiles/techknight.json
chmod 600 ~/.brainbase/cloudflare/profiles/*.json
```

Set `wranglerProfile` and `accountId` in each JSON file. Do not put an API token,
global API key, email address, or other credential in these files. Wrangler owns the
OAuth credentials for its named profiles.

Optionally install a local command:

```bash
ln -sfn "$PWD/scripts/cloudflare-profile.mjs" ~/.local/bin/cloudflare-profile
```

## Login and diagnosis

Create or refresh each named Wrangler login explicitly:

```bash
cloudflare-profile unson login
cloudflare-profile techknight login
```

Check the current directory's Wrangler config and named authentication without
changing Cloudflare resources:

```bash
cloudflare-profile unson doctor
cloudflare-profile techknight doctor --config /path/to/wrangler.toml
```

`doctor` prints only profile names, a shortened Account ID, the checked config path,
and authentication availability. It does not print credentials.

## Run Wrangler

Put all Wrangler arguments after `--`:

```bash
cloudflare-profile unson -- deployments list --config /path/to/wrangler.toml
cloudflare-profile techknight -- tail --config /path/to/wrangler.jsonc
```

For production log tails, keep the existing bounded-tail safety wrapper outside the
profile wrapper:

```bash
wrangler-tail-bounded --duration 10m -- \
  cloudflare-profile unson -- tail --config /path/to/wrangler.toml
```

The wrapper refuses a config containing any Account ID different from the selected
profile. It also removes inherited API-token and global-key environment variables so
they cannot override the selected OAuth identity. CI and non-interactive API-token
authentication remain separate from this interactive operator wrapper.

# CLI

BrainbaseのCLIは、オンボーディング、MCP起動、doctorを提供します。

## build

```bash
npm run build
```

## doctor

ローカルSSOTと設定を確認します。

```bash
npm run doctor
```

## onboarding

初期化:

```bash
npm run onboard:init
```

ガイド付き開始:

```bash
npm run onboard:start -- --target codex
```

承認済みfactのseed:

```bash
npm run onboard:seed
```

first value demo:

```bash
npm run onboard:demo -- --scenario "次の商談準備をして"
```

MCP設定dry-run:

```bash
npm run onboard:install -- --target codex --dry-run
```

## start

MCP serverをstdioで起動します。

```bash
npm run start
```

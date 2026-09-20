---
id: story-mcp-preflight-fixture-portability
title: MCP候補のpreflight失敗をLinuxでも検証する
status: active
---

# MCP候補のpreflight失敗をLinuxでも検証する

開発者として、候補MCPのpreflight失敗時にcheckoutを変更しない契約を、個人環境のパスに依存せずCIで検証したい。

## 受け入れ条件

- reconcilerが使うreceipt、reconcile lock、runtime lockをテストfixture内へ隔離する。
- 候補preflightが失敗したとき、MCP checkoutのSHAとreceipt未作成を引き続き検証する。
- productionでは`/usr/bin/shlock`を使う現行の排他契約を維持し、Linux fixtureでは専用stubを注入できる。
- Linux CIで個人macOSパス配下の作成を試みない。

[Spec](../../specs/story-mcp-preflight-fixture-portability-spec.md)

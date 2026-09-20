---
name: add-mcp
description: "リポジトリ管理のMCP登録を追加・確認するガイド（独立NocoDB MCP退役後）"
---

# MCP追加・確認ガイド

**Version**: 2.0.0
**Last Updated**: 2026-09-20
**Maintainer**: Unson LLC

## 現在の契約

- プロジェクトで共有するMCP登録の正本は、リポジトリ直下の`.mcp.json`。
- Brainbase、Jibble、Slackの各共有MCPなど、現行サービスの登録は既存の`.mcp.json`と
  管理されたローカルランタイムに合わせる。既存のURL・transport・命名を勝手に複製しない。
- 個人設定ファイルや外部コピーをこのガイドから編集しない。認証情報は承認済みランタイムから
  注入し、`.mcp.json`や文書へsecretを保存しない。
- 独立NocoDB MCPは退役済みであり、登録・起動経路を復活させない。

## 独立NocoDB MCPの退役境界

退役後の状態は次のとおり。

- `.mcp.json`に独立NocoDBサーバーの登録がない。
- launchdの起動テンプレートはなく、旧ランチャーと`mcp/nocodb/src/index.ts`は、認証値・環境値・
  MCP SDK・network transportを読む前に終了コード`78`を返す。
- `mcp/nocodb`は移行互換、canonical taskの書込みガード、退役境界の証拠テストを保持するための
  パッケージであり、Claude Codeから使うMCPサーバーではない。
- NocoDBデータ、移行用RESTスクリプト、Infisicalの設定・secretは削除しない。

したがって、旧NocoDB用のCLI登録、credential用環境変数、個人ホーム配下の古い`tools/`パスを
追加・復元しない。既存の利用者設定や外部コピーの一括修正も、このリポジトリの変更範囲外とする。

退役境界の確認:

```bash
npm --prefix mcp/nocodb test
```

このテストは、登録・launchdテンプレートがないこと、外部コマンド・認証値・環境値・SDK・network
transportを読む前に退役エントリが終了すること、canonical taskの書込みガードが残っていることを
確認する。

## 新しいMCPを追加する手順

### 1. StoryとSpecを先に固定する

追加理由、利用者に見える結果、transport、認証境界、失敗時の振る舞い、検証コマンドを最小の
Story/Specに記録する。既存の退役契約を回避するための新しい補助サーバーは作らない。

### 2. 既存の正本と影響範囲を確認する

```bash
sed -n '1,220p' .mcp.json
node scripts/graphify-impact-context.mjs --repo . --ensure-graph \
  --file .mcp.json --file <変更対象>
```

Graphifyの結果が`unknown`、`unmatched`、または空でも「影響なし」とは判定しない。対象ファイル、
既存の実装、Story/Specを直接確認し、未確認の範囲は未確認のまま残す。

### 3. リポジトリの通常PR経路で登録する

- HTTP transportなら、承認済みの管理ランタイムが提供するURLを`.mcp.json`に登録する。
- stdio transportなら、リポジトリ内のレビュー済みランチャーと相対パスを使う。個人の絶対パスを
  共有設定へ入れない。
- secret、token、個人設定の値をコミットしない。必要なcredentialは実行時の承認済み注入経路に
  残す。
- 変更は対象を絞ったbranchで実装し、影響テスト、独立レビュー、CI、通常のPR・merge経路を通す。
  このSkillは本番デプロイ、権限付与、外部送信を承認しない。

### 4. 変更後に確認する

```bash
git diff --check
<変更対象パッケージのテストコマンド>
```

Claude Codeの有効設定を読み取り専用で確認する必要がある場合は、`claude mcp list`または
`claude mcp get <name>`を使える。ただし、個人設定の修正や、既存サービスを退役経路へ戻す判断は
この確認から導かない。HTTP endpointの応答、認証、保存、再起動後readbackが必要な変更は、Story/Spec
に記録した対象範囲だけで別途検証する。

## チェックリスト

- [ ] Story/Specに目的、境界、失敗時の振る舞い、検証方法がある
- [ ] `.mcp.json`と関連実装を直接確認した
- [ ] Graphifyの結果を確認し、`unknown`を「影響なし」に変換していない
- [ ] secret、個人絶対パス、外部コピーを変更していない
- [ ] 変更対象のテストと`git diff --check`を実行した
- [ ] 独立レビュー、CI、通常のPR経路を確認した
- [ ] standalone NocoDB MCPを再登録・再起動していない

## 参照

- `.mcp.json`
- `mcp/nocodb/README.md`
- `docs/specs/story-retire-standalone-nocodb-mcp-spec.md`
- `docs/user_stories/active/story-retire-standalone-nocodb-mcp.md`

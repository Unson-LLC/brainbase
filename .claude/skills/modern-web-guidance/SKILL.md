---
name: modern-web-guidance
description: Brainbase OSSの ui/ のHTML・CSS・ブラウザ側JavaScriptを書く・直す前に使う。dialog、popover、レイアウト、アニメーション、フォーム、アクセシビリティ、性能など、Webの機能を使う変更が対象。サーバー側、CI、テストだけの変更には使わない。
---

# Modern Web Guidance（Brainbase用の入口）

## Purpose

`ui/` のコードを、古い書き方ではなく現在のWebの機能で書く。ガイドの本体は GoogleChrome の `modern-web-guidance` で、このリポジトリは版を `package.json` の devDependencies に固定している。ガイドをここへ写さない。

## 使い方

`npm ci` の後、リポジトリの直下で実行する。`DISABLE_TELEMETRY=1` を必ず付ける。付けないと、検索語と取得したガイドのIDがGoogleへ送られる。

1. 探す。画面の部品や機能を2〜5語の英語で書く。製品名、画面名、ファイル名は入れない。

   ```sh
   DISABLE_TELEMETRY=1 npx modern-web-guidance search "light dismiss dialog"
   ```

2. 読む。検索結果の `id` を渡す。出力がファイルに保存されたら、そのファイルを最後まで読む。

   ```sh
   DISABLE_TELEMETRY=1 npx modern-web-guidance retrieve "<id>"
   ```

3. 当てはめる。ガイドの「Fallback strategies」を必ず読む。一部のブラウザが未対応の機能は、機能検出つきの代替を残す。

4. 確かめる。

   ```sh
   npx vitest run tests/ui/modern-web-legacy-scan.test.mjs
   ```

## Brainbaseでの決まり

- 共通部品は [docs/specs/oss-common-ui-spec.md](../../../docs/specs/oss-common-ui-spec.md) が先。ガイドと食い違うときは規約に従い、規約を変えるなら所有するこのリポジトリで変える。
- 頼まれていない機能を足さない。使っていない新しい機能があること自体は、直す理由にならない。
- スキャンが機械的に見るのはガイドの約20%。0件でも、残りは手順1〜3で確かめる。
- スキャンを0件にするために、安全な代替のコードを消さない。

## Verification

変更した画面を実際のブラウザで開いて確かめる。スキャンとテストの合格だけで完了にしない。

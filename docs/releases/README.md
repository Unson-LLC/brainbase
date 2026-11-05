# リリースノートの作成

PR テンプレートの `## リリースノート` に利用者向け変更を書く。内部変更だけなら「なし（内部変更）」と理由を書く。

ローカルの PR 本文またはマージコミット全文を渡す:

```sh
node scripts/draft-release-note.mjs 0.41.8 /tmp/pr-body.md
# stdin も利用可。JSON を stdout に出力するだけでファイルは更新しない。
npm run docs:check
```

JSON の versionHistory は `## Unreleased — develop` に手動統合し、release は releasePath にレビュー後に反映する。版を確定するときは version-history にも同じ版を記録する。候補・公開済みの状態は既存の根拠を維持する。本文全体からの推測や自動公開は行わない。秘密・内部情報を人手で確認する。

`docs:check` は version-history と個別ノートの版集合を双方向に照合する。旧版の追補は既存履歴の転記であり、新たな公開確認ではない。docs CI の既存検証ステップでこのチェックを実行する。

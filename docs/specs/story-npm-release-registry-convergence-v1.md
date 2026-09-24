# npm公開後の遅延registry反映 Spec

## 背景

GHA run `35942948959` のattempt 1では、npm publish自体は成功した一方、`scripts/npm-release.mjs`のregistry metadata検証が6回（約31秒）で終了し、npm側の伝播前に失敗した。attempt 2では同じversionを再公開せず、metadataが反映済みになったため成功した。

## 契約

publish後のmetadata検証は、次の順序を守る。

1. publish前のmetadataが一致していれば、publishを実行しない。
2. versionが未確認の場合だけ、同じvalidated tarballを一度publishする。
3. publish後はmetadataを最大8回読む。各試行間の待機は`1, 2, 4, 8, 16, 30, 30`秒を上限とし、最終試行まで最大91秒待つ。
4. `version`、`gitHead`、`dist.integrity`がvalidation proofと一致するまで、consumer dist-tagとstaging tagを変更しない。
5. 上限内に一致しなければ失敗する。再実行時に一致metadataが存在する場合は、immutable versionへ再publishしない。

## 不変条件

- registry metadataの不一致を、単なる伝播遅延として無期限に待たない。
- `gitHead`とSHA-512 `dist.integrity`の検証を緩めない。
- publish成功後の検証失敗を理由に、同じrun内で`npm publish`を再実行しない。
- dist-tag reconciliationとstaging tag cleanupは、immutable metadata検証後だけ行う。

## 検証

- `tests/npm-release.test.ts`で、metadataが8回未確認でも9回目に一致すればpublish一回・tag reconciliation一回で収束することを確認する。
- 同テストで待機列がboundedであることを確認する。
- 既存のimmutable collision、registry integrity mismatch、no-republish、never-convergesのテストを維持する。

```bash
npx vitest run tests/npm-release.test.ts --reporter=verbose
```

## 対象外

この変更ではpackage version、npm公開、GitHub Actions workflow、認証情報、dist-tag命名、GitHub Releaseを変更しない。

# Story: Canonical Task作成結果を冪等に回収する

## 背景

Cloudflare版Manaが同じ冪等キーでTask作成結果を回収した際、Task自体はversion 1で保存済みなのに、Brainbaseが未定義の`recoverCreatedTask`を呼び出して500を返した。
これによりSlackでは作成失敗と表示され、再試行による重複作成リスクが生じる。

## 受け入れ条件

- [x] AC1: 同じ冪等キーと同じ入力で作成を再実行した場合、保存済みの同一Task version 1を返し、Taskを追加作成しない。
- [x] AC2: 同じ冪等キーを異なる入力で再利用した場合、`idempotency_conflict`（409）を返す。
- [x] AC3: 保存済みTaskが見つからない回収試行は未回収として扱い、通常の作成処理へ進める。
- [x] AC4: owner境界を満たさない保存済みTaskを回収結果として返さない。
- [ ] AC5: 修正後のBrainbase本番とCloudflare本番を使い、同じSlackスレッドでcreate→search→update→search→transition→searchが誤失敗なく完了する。

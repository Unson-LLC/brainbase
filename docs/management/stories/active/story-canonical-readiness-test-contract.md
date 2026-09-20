# Canonical Task readiness証跡を現行テストへ追従させる

## Outcome

本番のCanonical Task mutationを有効化するとき、正規collectorが現行のlegacy route guardを実行し、テスト名の変更だけで証跡を失敗させない。

## Acceptance criteria

- SC-030と`surface.legacy.route`が現行のlegacy route guard 9ケースを実行する。
- collectorが0 assertionではなく成功したassertionを記録する。
- before-enable preflightが全64件の現行HEAD証跡を検証できる。

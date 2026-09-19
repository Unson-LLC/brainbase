# Story: 検証済みの旧実装残存を除去する

利用者として、現役の検索・Wiki読み取りと廃止APIの明示拒否を維持したまま、到達不能な旧実装と使われない設定をなくしたい。

## Spec / 受け入れ条件

- MCPの `get_context` / `search_wiki` の到達不能case本体と専用import、旧index更新対象名を除去する。
- HTTP/stdioで旧検索を明示拒否するガードを維持する。現役検索、Wiki resource一覧・読み取り、共有関数は維持する。
- `config/com.brainbase.cleanup.plist` を削除する。各ホストの登録操作は対象外。
- `scripts/check-secrets.sh` の `auto-cleanup-cron.sh` 除外1行を削除する。廃止通知用スクリプトと副作用防止テストは維持する。
- 対象テストと型検査で確認する。削除対象の再導入を検出する回帰テストを追加する。

## 境界・根拠

既存ADR-019の廃止方針に従う後処理。新しい保存先や実行境界は導入しない。共有データ削除・本番反映・他ホスト変更は含まない。
Graphifyの初回照合はpartial（対象2ファイル未収録、鮮度不明）。直接参照調査とHTTP/stdio・退役スクリプトの対象テストで補完する。

## 検証結果

- 退役スクリプト・再導入防止テスト: 17件成功（Node 22.23.2）。
- MCP HTTP/stdio・Wiki filter・core ontology: 26件成功。
- MCP型検査、シェル構文検査、差分の空白検査: 成功。
- 変更後のGraphify再生成もpartial。設定・シェルの2ファイル未収録、鮮度・影響の判定はunknownのまま。全領域の影響なしを意味しない。
- 本番反映、各ホストのLaunchAgent登録状態、外部からの公開ヘルパー利用は未確認・対象外。

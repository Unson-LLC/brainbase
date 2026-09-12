---
story_id: story-failed-resolver-audit-message
status: accepted
---

# Spec

1. 正しいturnに結び付いたResolverのPostToolUseFailureを記録すると、success=false、契約なしのイベントと、非空の固定された失敗監査メッセージを得る。Remote HTTP経由でも503にせずこの記録結果を返す。
2. 同一イベントの再送は同一の監査結果を返し、件数を増やさない。成功した別呼び出しの契約を上書きしない。
3. 別turn、不一致の入力、同じtool use IDに異なる内容を送る場合の拒否を維持する。
4. この出力は判断の成功や個人KG検索の実行を証明しない。失敗イベントだけでは有効な判断契約・検索結果・最終完了を生成しない。
5. 未知の応答や一般の空監査出力を許可する例外をHTTP境界へ追加しない。

対象: scripts/codex-hooks/judgment-resolver-host.mjs、およびHostとRemote HTTP境界の回帰テスト。

出荷検査: Graph書き込み契約の実行先は`ubuntu-latest`とする。Node.js 22、PostgreSQL 16、全テスト、権限、10分の上限と同時実行制御を維持し、実Actionsの成功で確認する。

実リポジトリを走査するinventory検査1件は、4並列のCIで5.59秒を要したため上限15秒とする。小さなfixtureの検査・assertion・ジョブ全体の上限は変更しない。

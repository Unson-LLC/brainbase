# Architecture: Canonical Task作成結果の冪等回収

## 決定

作成の正本と冪等性キーは引き続きCanonical Taskリポジトリが所有する。
`CanonicalTaskService`に作成結果回収を実装し、operation coordinatorが再開・再送を検出した時だけ利用する。

回収処理は次の順でfail-closedに判定する。

1. operation keyと一致するTaskを`findByIdempotencyKey`で読む。
2. Taskがなければ`recovered: false`を返し、coordinatorに通常作成を委ねる。
3. 保存済みpayload fingerprintが現在のfingerprintと異なる場合は409にする。
4. owner境界を再検査する。
5. 同一Taskを`recovered: true`で返し、再作成しない。

Cloudflare側でエラーを成功へ読み替えない。Brainbase正本が冪等な成功応答を返すことで、Taskの副作用と応答を一致させる。

## リリース境界

Brainbaseを先にデプロイし、CloudflareのTask boardはOFF、LightsailのTask placementとtaskCanvasはONのままE2Eする。作成・更新・状態遷移・正本検索がすべて成功した後にだけ所有権切替を再開する。

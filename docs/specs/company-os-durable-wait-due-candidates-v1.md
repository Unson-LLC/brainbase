# Durable wait due candidates v1

対象Story: [`story-company-os-durable-wait-due-candidates-v1`](../stories/story-company-os-durable-wait-due-candidates-v1.md)

`GET /api/v1/durable-waits:due?limit=50&cursor=<position>` はhostが認証したcontextを必須とする。既存の`GET /api/v1/durable-waits/due`はwait ID `due`の読取として残す。handlerはcontextの`tenantId`・`principal`・`scopeType`・`scopeId`をstoreへ渡し、scope型がない場合は候補探索を拒否する。HTTP createはtrusted `tenantId`を記録へ保存し、due探索は記録のtenantとscope型・IDがすべて一致する場合だけ候補にする。tenant未記録の旧データは除外し、所属を推測しない。queryは`limit`と`cursor`のみ許可し、他の主体・scope指定や重複parameterを拒否する。

storeは自身のclockで判定する。`state=waiting` かつ `deadline.due_at` または `deadline.next_review_at` が到来した記録だけが候補となる。`claimed`や`reconciliation_wait`は含めない。候補ごとに現在のclaim ACLとProblem snapshotを検証する。ACL providerが明示的に`false`を返す場合だけ候補から除外し、provider例外・snapshot検証失敗・ledger破損はエラーとする。応答は`{ candidates: [{ wait_id, due_at }], next_cursor?: string }`。limitは1〜100、既定50。安定したwait ID順でページを進め、cursorは同じtenant/principal/scopeだけに使用できる。ページは同時更新で厳密なスナップショットではないので、定期巡回は先頭から始める。

このGETは候補探索に限る。返却後の状態・期限・ACL・snapshot変更は、既存の`POST /claim`が改めて検証する。HTTP createは変更前にtrusted scope型とIDを検証し、tenantが記録された待機のread・claimを含む操作はそのtenant・scope型・IDをtrusted contextと照合する。旧データのread・claim動作は維持するため、tenant未記録の旧データを含む共用storeは本番でtenant隔離済みとみなせない。cursorはtenant・principal・scope型とIDに束縛し、プロセス内鍵のHMACで改変を拒否する位置情報であり、権限証明ではない。プロセス再起動・別プロセスではcursorが無効になるため、巡回は先頭から再開する。hostの認証、tenant別store生成、旧データのtenant移行とManaのcron/queue接続は別途必要であり、それまでは本番の候補巡回を有効化しない。

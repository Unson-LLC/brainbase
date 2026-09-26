# Canonical Graph Foundation history

Story: story-canonical-graph-foundation-history-v1

Graph current rowと同じDBの履歴を正本の版保存として扱う。Foundationのpayloadは`foundation`に完全なFoundationDefinitionを保持する。哲学のpayloadは既存内容を保持し、`judgmentApplicability: {scope: {type,id}, validFrom, validUntil?}`がある版だけ判断に使える。

履歴はGraph rowのentity_type・payload・project_id・role_min・sensitivity・lifecycle_statusを保存する。移行時の現在値を最初の保存版とし、移行前の履歴を作らない。哲学には独立した単調増加の保存版を割り当てる。Foundationはpayload内revisionを使い、同じ版の内容変更と版の飛び越しを拒否する。ACL変更も明示改訂にする。

現在行の消失・非active・RLS不可視は旧版も読取不可。履歴を直接書換・削除できる通常APIは提供しない。移行はtransactionで行い、初期化とtrigger設定を原子的に実施する。rollbackはmountを無効にし、保存済み履歴は消さない。

現在の権限はhost認証から得たDB transactionで照合する。哲学current ACLは現在Graph行への読取許可を共通ACLに投影する。適用範囲の現在値・保存版・要求scopeをすべて比較する。

哲学もexact ID/revisionから正本のpayload・digest・適用範囲を取得できる。`foundation_read(type: philosophy)`は現在の権限を検証したcanonical read portを使い、取得済みdigestを必須にしない。判断への利用は別途pin検証を通す。

# Non-cyclic outcome authority proof spec

ManaはDurable Objectから権限を再読込した直後、Ed25519でdetached JWSを生成する。Brainbase bridgeは対応する公開鍵、issuer、audience、最大TTL 60秒、時刻skew 10秒、依頼本文との完全一致を検証する。

検証後は`authority_proof`を本文から除去し、検証済みprojectionだけを既存の内部headerへ変換する。署名不一致またはscope不一致は`403 OUTCOME_AUTHORITY_PROOF_INVALID`、鍵設定不備は`503 BRIDGE_CONFIGURATION_INVALID`とする。


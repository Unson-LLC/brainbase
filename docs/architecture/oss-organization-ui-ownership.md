# ADR: OSS UIを組織版UIの土台にする

- 状態: 採用
- 日付: 2026-09-20

## 決定

単一利用者でも成立するBrainbase UIはOSS `brainbase` が所有する。`brainbase-organization` はOSS UIを依存として組み込み、組織固有機能だけを追加する。顧客固有差分は顧客設定repo、実行系はruntime/backendが所有し、一般UIを再実装しない。

最初の移管単位は、ホストからAPIと文脈を注入できる知識UIとMana委任UIである。組織版の認証やtenant境界はホスト側に残るため、共通UIへ組織秘密や権限判定を持ち込まない。

## 却下した案

- OSSをUIなしに固定する: 組織版との二重実装を避けられない。
- 組織版からソースをコピーする: 修正と機能が分岐する。
- 顧客repoへUIを置く: brandingと製品機能の責務が混ざる。

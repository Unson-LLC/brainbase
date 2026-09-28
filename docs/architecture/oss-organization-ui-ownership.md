# ADR: OSS UIを組織版UIの土台にする

- 状態: 採用
- 日付: 2026-09-20
- 改訂: 2026-09-28。Mana委任UIを組織版の画面にした（末尾の節）

## 決定

単一利用者でも成立するBrainbase UIはOSS `brainbase` が所有する。`brainbase-organization` はOSS UIを依存として組み込み、組織固有機能だけを追加する。顧客固有差分は顧客設定repo、実行系はruntime/backendが所有し、一般UIを再実装しない。

最初の移管単位は、ホストからAPIと文脈を注入できる知識UIとMana委任UIである（Mana委任UIは2026-09-28に組織版の画面へ移した）。組織版の認証やtenant境界はホスト側に残るため、共通UIへ組織秘密や権限判定を持ち込まない。

## 却下した案

- OSSをUIなしに固定する: 組織版との二重実装を避けられない。
- 組織版からソースをコピーする: 修正と機能が分岐する。
- 顧客repoへUIを置く: brandingと製品機能の責務が混ざる。

## Mana委任UIの扱い（2026-09-28改訂）

横断ADR（brainbase-project ADR-011 U2、2026-09-28）で、Mana委任UIは組織版の画面とし、`brainbase-organization`が正本を持つことにした。Mana委任UIはUnsonの実行基盤（Mana）に結びつくため、単一利用者でも成立する共通UIに当たらない。OSSのローカルのWeb画面はこの部品を使っていないので、OSSの利用者の画面は変わらない。

移し替えは、組織版が同じ内容を自分の画面として持って`/oss/`からの配信をやめた後に、このrepoから`ui/outcome-mana.js`・`ui/outcome-mana.css`・`ui/icons/mana`、公開subpath（`./ui/outcome-mana`・`./ui/outcome-mana.css`・`./ui/icons/*`）、部品のテストと見た目の検査を外す順で行った。公開subpathを外す互換を壊す変更なので、0.8.0の次のminorで公開する。

知識UIは、引き続きこのrepoが所有し、組織版が組み込む。

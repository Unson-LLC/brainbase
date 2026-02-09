# _codex-sample - UNSON brainbase構造サンプル

**目的**: UNSONメンバーが _codex/ を構築する際のリファレンス

**重要**: これはサンプル構造です。実際のデータは各自で `_codex/` に作成してください（.gitignoreで除外）。

---

## ディレクトリ構造

```
_codex-sample/
├── common/                      # 共通情報
│   ├── meta/                   # メタ情報
│   │   ├── people/             # 人物情報
│   │   │   └── sample_person.md
│   │   ├── organizations/      # 組織情報
│   │   │   └── sample_org.md
│   │   └── raci/               # RACI構造
│   │       └── sample_raci.md
│   └── frameworks/             # フレームワーク説明
│       └── story-driven-strategy-framework.md
│
└── projects/                    # プロジェクト情報
    ├── salestailor/
    │   └── 01_strategy.md      # プロジェクト戦略サンプル
    ├── zeims/
    │   └── 01_strategy.md
    └── unson/
        └── 01_strategy.md
```

最終更新: 2026-02-09

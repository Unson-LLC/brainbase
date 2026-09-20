---
id: story-active-skill-contracts
title: 現行の開発指示を矛盾なく読み込む
status: active
---

# 現行の開発指示を矛盾なく読み込む

利用者として、現在使うSkillsとAGENTSに従って、不要な固定工程や古い契約に戻らず作業を完了したい。

## 受け入れ条件

- 現行入口のTDD、リファクタリング、設計、セキュリティは、適用条件と必要な検証を示し、固定モデル・件数・一律カバレッジを要求しない。
- Judgment Skillは現行Hostの監査表示・最終state契約に従い、receiptを操作権限にしない。
- AGENTS/CLAUDEは同一かつ200行未満で、Wiki復活を指示しない。
- Executorの選択は利用者・実行環境の現行分担に従う。
- マージ済みの短縮版と今回の変更を実際のSkill読み込み元で確認する。反映時は既存dirty変更を保持する。
- Jevは補助に限定し、休眠Skillを現行修正の優先候補にしない。

開発モード: SIMPLIFICATION。Hostや配布機構を新設せず、指示の整理と対象ファイルの安全な反映に限定する。

[Spec](../../specs/story-active-skill-contracts-spec.md)

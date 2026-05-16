---
name: brainbase-docxはreadできないためpython-docx等で抽出・生成する
description: DOCXはReadできないためpython-docx等で抽出・生成する
---

# brainbase-docxはreadできないためpython-docx等で抽出・生成する

## Trigger
- Use when this pattern appears: DOCXはReadできないためpython-docx等で抽出・生成する

## Steps
- which pandoc || which python3
- python3 -c "from docx import Document; doc=Document('/path/file.docx'); ..."
- ModuleNotFoundError: No module named 'docx' の場合:
- pip3 install python-docx

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/docxはreadできないためpython-docx等で抽出・生成する

## Source
- Promoted from explicit_learn / success
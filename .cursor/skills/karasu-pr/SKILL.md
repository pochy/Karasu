---
name: karasu-pr
description: >-
  Creates GitHub pull requests for Karasu using gh CLI, summarizing branch
  commits and following project doc links. Use when the user asks to create a
  PR, open a pull request, or prepare a merge description.
---

# Karasu PR 作成

## 前提

- **GitHub CLI (`gh`)** を使う
- コミット / push はユーザー依頼時のみ。PR 作成時は push が必要なら `-u origin HEAD`

## 手順

1. 並列で確認:
   - `git status`
   - `git diff` / `git diff --staged`
   - 追跡ブランチと `main` との差分: `git log main..HEAD --oneline` と `git diff main...HEAD`
2. **全コミット**を読み、PR 本文に反映（最新 1 件だけにしない）
3. `git push -u origin HEAD`（未 push の場合）
4. `gh pr create` — HEREDOC で body

## 本文テンプレート

```markdown
## Summary
- （変更の要点 1〜3 行）

## Test plan
- [ ] npm run build
- [ ] cd src-tauri && cargo test
- [ ] （機能別の手動確認）
```

## 記載のヒント

- 性能影響がある場合は「編集中ゼロ / プレビュー時のみ」等を明記
- バックログ ID があれば `A3` / `F2` のように引用
- 設計変更は `docs/design-decisions.md` へのリンクを含める

## 返却

作成した PR の URL をユーザーに渡す。

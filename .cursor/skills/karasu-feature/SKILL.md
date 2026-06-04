---
name: karasu-feature
description: >-
  Implements or evaluates Karasu features against design-decisions.md backlog,
  performance priorities, and minimal diff scope. Use when adding UX, sidebar,
  preview, Tauri commands, settings, or when the user asks for backlog IDs,
  feature proposals, or design-decisions updates.
---

# Karasu 機能開発

## 着手前

1. Read `docs/design-decisions.md` — [設計で最優先していること](docs/design-decisions.md#設計で最優先していること) と [機能バックログ](docs/design-decisions.md#機能バックログ提案一覧)
2. 既存 ID（A〜F 実装済み、D 提案、E 却下）と重複しないか確認
3. [ソースとドキュメントの対応](docs/design-decisions.md#ソースとドキュメントの対応) で変更ファイルを特定

## 性能チェック（必須）

| 質問 | 望ましい答え |
|------|----------------|
| 編集中に常時動く？ | いいえ |
| 新しい常駐 WASM / 巨大 DOM？ | いいえ |
| 全フォルダ再帰スキャン？ | いいえ（1 階層 `list_directory`） |
| 自動保存？ | いいえ |

Split View・別ウィンドウ・別プロセスを検討する場合は、**1 WebView・プレビューは必要時のみ** と比較して `design-decisions` に追記する。

## 実装手順

```
- [ ] Rust コマンド（必要なら）+ lib.rs 登録
- [ ] フロント接続（main / sidebar / settings）
- [ ] styles.css（.preview / .sidebar / ツールバー）
- [ ] design-decisions バックログ行 + README 1 行
- [ ] npm run build && cd src-tauri && cargo test
```

## 却下済み（再提案しない）

E1 常時 2 ペイン、E2 既定自動保存、E3 Git UI、E4 ノート DB、E5 WYSIWYG、E6 プラグイン、E7 Shiki 乗換

## コミット

ユーザーが「コミットして」と言うまで commit しない。メッセージは英語 1 行要約 + 理由（既存 log に合わせる）。

## 詳細

- ファイル一覧・永続化キー: [reference.md](reference.md)

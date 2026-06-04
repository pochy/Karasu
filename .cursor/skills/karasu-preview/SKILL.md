---
name: karasu-preview
description: >-
  Changes Karasu Markdown preview (marked GFM extensions, sugar-high, Mermaid
  lazy load, preview CSS, front matter strip). Use when editing markdown.ts,
  mermaid-preview.ts, preview styles, or GFM/Mermaid parity documentation.
---

# Karasu プレビュー変更

## パイプライン

```
stripFrontMatter → marked (GFM + extensions) → innerHTML
→ renderMermaidIn (pre.mermaid のみ)
```

## marked 規約

- 拡張の登録順: `markedFootnote` → `markedAlert` → `gfmHeadingId`
- `lang === 'mermaid'` → `<pre class="mermaid">`（escape のみ、sugar-high 禁止）
- それ以外 → sugar-high（`sugar-high/presets`）
- `gfm: true`, `breaks: false`

## Mermaid 規約

- `querySelectorAll('pre.mermaid')` が 0 なら **import しない**
- `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })` は初回のみ
- `mermaid.run({ suppressErrors: true })`
- 上限: 20 図 / ブロック 8KB（超過は `<pre>` のまま）

## スコープ外

KaTeX・LaTeX 数式、GitHub の拡張テーブル（colspan）— 追加しない

## CSS

- ライト文書スタイルは `.preview` 配下
- `pre.mermaid` はコード用ダーク `pre` を上書き（白背景・横スクロール可）
- `.preview .mermaid svg { max-width: 100% }`

## 検証

```bash
npm run build
```

手動: `docs/samples/gfm-mermaid.md` を開き `Cmd/Ctrl+P`（初回のみ Mermaid チャンク読込）。

## ドキュメント

`docs/design-decisions.md` の「プレビュー Markdown（GFM + Mermaid）」節と F1/F2 表を整合させる。

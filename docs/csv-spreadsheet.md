# CSV スプレッドシート機能

Karasu の CSV モードは、巨大 CSV（1TB 級を想定）を **Excel / スプレッドシート風に閲覧・セル編集** するための機能です。Markdown / JSON と同様に Activity Bar から切り替えます。

設計判断の全体方針（性能優先順位・明示保存など）は [`design-decisions.md`](design-decisions.md) を参照してください。本書は CSV 機能の **実装詳細・データフロー・制限** の正本です。

---

## 目的と位置づけ

| 項目 | 内容 |
|------|------|
| 対象 | `.csv` / `.tsv` |
| 非対象 | Excel バイナリ（`.xlsx`）、数式エンジン、ピボット、グラフ、行・列の挿入削除 |
| UX | 表形式表示、ダブルクリックでセル編集、**明示保存のみ**（自動保存なし） |
| サイドバー | CSV モードでは **非表示**（Markdown 専用） |
| 技術方針 | ファイル全体を常にメモリに載せない。表示範囲だけ DOM + 必要行だけ I/O |

---

## アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────────────────┐
│  WebView（Vanilla TypeScript）                                        │
│  ├ Activity Bar … 「CSV」モード                                       │
│  ├ editor.ts … EditorController（開く/保存/モード切替/解放）          │
│  ├ spreadsheet.ts … TanStack Virtual（行）+ Table Core（列ヘッダー）   │
│  └ api.ts … Tauri invoke ラッパー                                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ invoke / events
┌───────────────────────────────▼──────────────────────────────────────┐
│  Rust（src-tauri/src/csv/）                                            │
│  ├ scanner.rs … クォート対応 CSV 行・フィールド解析                     │
│  ├ index.rs … スパースチェックポイント索引 + ディスクキャッシュ          │
│  └ session.rs … ロード戦略・セッション・LRU 行キャッシュ・保存          │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ seek / read / write
                         CSV ファイル（ディスク）
```

**レイヤの役割分担**

| レイヤ | 担当 |
|--------|------|
| TanStack Virtual | 見えている行 + overscan 分だけ DOM を維持 |
| TanStack Table Core | 列定義・ヘッダー描画（ソート等の高度機能は未使用） |
| Rust セッション | 行データの正本（メモリ or ストリーミング）、編集オーバーライド |
| 索引（>100MB） | 任意行への seek を可能にするスパースチェックポイント |

---

## ファイルサイズ別ロード戦略

Karasu は **100MB** を閾値に、2 段階で読み込みます。

| 条件 | モード | Rust 側の保持 |
|------|--------|---------------|
| **≤ 100MB** | **メモリ** | 全行を `Vec<Vec<String>>` に展開 |
| **> 100MB** | **ストリーミング** | ファイルはディスク上。必要行だけ `seek` + 読み取り |

> 参考: DevToolBox 等では 1MB / 32MB / 32MB 超の 3 段階を採用している例もある。Karasu はユーザー要件に合わせ **100MB 超のみ** ストリーミングとする。

### ストリーミングモードの流れ

```
巨大 CSV
  ↓ 先頭 4MB をブートストラップ（最大 1000 行）→ 列数・行数推定・即表示
  ↓ バックグラウンドで全ファイル走査 → スパース索引構築
  ↓ 索引 JSON を ~/Library/Caches/.../csv-index/ に保存（2 回目以降は再利用）
  ↓ 表示範囲の行だけ read_rows → 48MB LRU キャッシュ（生バイト）
  ↓ セル表示時にフィールド単位デコード
TanStack Virtual … 見えている行だけ <tr>
```

### ブートストラップ（即表示）

索引完成を待たず表を出すため、`csv_open` 時に先頭 **4MB**（最大 **1000 行**）だけ読み、以下を返します。

- 列数（1 行目をヘッダーとして扱う）
- 行数（ファイル末尾まで読めた場合は正確、否则は `(file_size / bytes_read) * rows_parsed` で推定）
- ヘッダー文字列配列

索引構築完了後、`csv-index-ready` イベントで正確な `row_count` に更新されます。

---

## Rust バックエンド

### モジュール構成

| ファイル | 責務 |
|----------|------|
| `scanner.rs` | UTF-8 BOM 除去、クォート内改行・カンマを考慮した行境界検出、フィールド parse / serialize |
| `index.rs` | 1 万行ごとのチェックポイント `(行番号, バイト位置)`、索引 JSON の load/save、`read_row_bytes` |
| `session.rs` | セッション管理、Tauri コマンド実装、編集オーバーライド、保存 |
| `mod.rs` | 公開 API の re-export |

### 定数（`session.rs` / `index.rs`）

| 定数 | 値 | 意味 |
|------|-----|------|
| `MEMORY_THRESHOLD` | 100 MiB | これ超えはストリーミング |
| `BOOTSTRAP_BYTES` | 4 MiB | オープン時の先頭読み込み上限 |
| `BOOTSTRAP_MAX_ROWS` | 1000 | ブートストラップで解析する最大行数 |
| `ROW_CACHE_MAX_BYTES` | 48 MiB | ストリーミング時の行バイト LRU 上限 |
| `CHECKPOINT_INTERVAL` | 10_000 | 索引のチェックポイント間隔（行） |

### セッション（`CsvSession`）

同時に保持するセッションは **1 件**（`csv_open` 時に `sessions.clear()`）。

```rust
struct CsvSession {
    path: PathBuf,
    file_size: u64,
    mode: LoadMode,           // InMemory | Streaming
    column_count: u32,
    overrides: HashMap<(u64, u32), String>,  // 編集したセルのみ
    dirty: bool,
    epoch: u64,               // 索引スレッドの世代 ID
}
```

**編集モデル**: セル編集は `overrides` マップに `(行, 列) → 値` として保持。読み取り時に元データへマージ。保存時に全行をストリーミング書き出し、オーバーライドを反映したうえで `overrides` をクリア。

### スパースチェックポイント索引

全行の `(行 → バイト位置)` を密に持たない（数億行で索引自体が GB 級になりうるため）。

```
0 行目      → offset 0
10,000 行目 → offset 12,345,678
20,000 行目 → offset 24,567,890
...
```

任意行 `N` へのアクセス:

1. `N` 以下で最大のチェックポイントまで `seek`
2. そこから行境界をスキャンしながら `N` まで進む
3. 該当行の生バイト列を LRU キャッシュへ

索引ファイル（JSON）のキャッシュキーは **パスハッシュ + source_size + mtime**。ファイル更新で無効化。

### 索引構築スレッド

100MB 超かつキャッシュに索引がない場合、バックグラウンドスレッドで全ファイル走査します。

- 進捗: Tauri イベント `csv-index-progress` `{ path, rows, done }`
- 完了: `csv-index-ready` `{ path, row_count }`
- セッション `epoch` が一致しない場合（`csv_close` / 別ファイルを `csv_open` 後）は更新・イベントを **無視**
- **キャンセル**: `build_index_from_file` は **1 MiB 読み込みごと** と **1 万行チェックポイントごと** に `should_continue()` を呼ぶ。`csv_close` や `csv_open`（別ファイル）で `SESSION_EPOCH` が進むと `index_build_still_valid` が false になり、走査を **早期終了** する（エラー `"索引構築がキャンセルされました"` でスレッド終了）

---

## Tauri コマンド

| コマンド | 引数 | 戻り値 | 説明 |
|----------|------|--------|------|
| `csv_open` | `path` | `CsvOpenResult` | セッション作成、ブートストラップ、必要なら索引構築開始 |
| `csv_read_rows` | `path`, `start_row`, `count` | `CsvRowBatch` | 行範囲取得（`count` は最大 500） |
| `csv_set_cell` | `path`, `row`, `col`, `value` | — | セルオーバーライド |
| `csv_save` | `path`, `output_path?` | `String` | ストリーミング書き出し（省略時は上書き） |
| `csv_close` | （なし） | — | **全** CSV セッション破棄・バックグラウンド索引の無効化 |

### `CsvOpenResult`

```typescript
{
  path: string;
  file_size: number;
  streaming: boolean;
  row_count: number;
  column_count: number;
  headers: string[];
  index_ready: boolean;
  dirty: boolean;
}
```

### Tauri イベント（フロントが subscribe）

| イベント | payload | タイミング |
|----------|---------|------------|
| `csv-index-progress` | `{ path, rows, done }` | 索引構築中（1 万行ごと） |
| `csv-index-ready` | `{ path, row_count }` | 索引完成 |

---

## フロントエンド

### ファイル構成

```
src/features/csv/
  api.ts          … invoke ラッパー・型
  editor.ts       … EditorController 実装
  spreadsheet.ts  … 仮想スクロール表 UI

src/styles/csv-editor.css
index.html        … #csv-screen, #csv-scroll, #csv-table-inner 等
```

### Activity Bar と `EditorMode`

- `editor-mode.ts` の `"csv"` を Activity Bar 第 3 アイコンで選択
- `main.ts` の `controllers.csv` が `createCsvEditor(host)` を返す
- Markdown / JSON と同じ `EditorController` インターフェース（`activate` / `deactivate` / `save` / …）

### TanStack Virtual + Table Core

React は使わず **Vanilla** で `@tanstack/virtual-core` と `@tanstack/table-core` を利用。

**行仮想化（Virtual）**

- スクロールコンテナ: `#csv-scroll`
- 全行高さの仮想キャンバス: `#csv-table-inner` に `getTotalSize()` を設定
- 固定行高 **28px**、`overscan: 25`
- 行配置: `<tr>` に `position: absolute` は **使わない**（ブラウザで効かない）。TanStack Table 例と同様 `translateY(virtualRow.start - index * size)` のみ

**列（Table Core）**

- 1 行目をヘッダーとして `ColumnDef` を生成
- `getHeaderGroups()` で `<thead>` を描画
- `createTable` 後に `table.initialState` を適用（空 `state: {}` だと `columnPinning` 未定義で落ちる）

**データ取得**

- 表示範囲 ± **40 行** を prefetch（50ms デバウンス）
- フロント行キャッシュ上限: **400 行** LRU
- 1 回の `csv_read_rows` は Rust 側で最大 **500 行**

### セル編集

1. セルをダブルクリック → `<input>` 表示
2. Enter / blur で確定 → `csv_set_cell` → `dirty = true`
3. Escape でキャンセル

### ショートカット（CSV モード・フォーカス時）

| 操作 | キー |
|------|------|
| 開く | `Cmd/Ctrl+O` |
| 保存 | `Cmd/Ctrl+S` |
| 別名で保存 | `Cmd/Ctrl+Shift+S` |

---

## メモリ管理と解放

Karasu の性能方針（常駐メモリを抑える）に沿い、CSV でも **不要になったら明示的に解放** します。本節は **CSV セッション単位** の解放を詳述します。**ウィンドウを閉じてメニューバー常駐に入るとき** のアプリ全体の `suspend` は [`design-decisions.md` — G1](design-decisions.md#メニューバー常駐とリソース解放g1) を参照してください。

### 用語

| 用語 | 意味 |
|------|------|
| **RSS** | Resident Set Size。プロセスが物理 RAM に載せている量。macOS の Activity Monitor「メモリ」列はこれに近い |
| **セッション** | Rust 側 `CsvSession` 1 件。パスをキーに `CsvRegistry` で管理（同時に実質 1 件） |
| **メモリモード** | ファイル ≤ 100MB。全行を `Vec<Vec<String>>` に展開 |
| **ストリーミングモード** | ファイル > 100MB。行バイト LRU（最大 48MB）+ スパース索引 |
| **世代 ID（epoch）** | 索引構築スレッドが「まだ有効か」を判定するための番号 |

### メモリ使用量の目安

ファイルサイズそのものより **展開後のヒープ** が問題になります。

| モード | 例（43.5 MB CSV） | Rust 側の主な常駐 |
|--------|-------------------|-------------------|
| メモリ | 541,911 行 × 8 列 | 全セル `String` + `Vec` オーバーヘッド → **ファイルサイズの数倍〜十数倍** になりうる |
| ストリーミング | 1 TB 級 | 行 LRU **最大 48 MB** + チェックポイント索引（行数に比例するが密索引より小さい）+ ブートストラップ用一時バッファ |

索引 JSON は **ディスク**（`~/Library/Caches/.../csv-index/`）に保存され、Rust ヒープには索引構築中のみ一時的に載ります。

### 「解放」ボタン（ツールバー）

CSV 画面ツールバー右端の **「解放」**（`#btn-csv-close`）は、開いている CSV を閉じてバックエンド・フロントのキャッシュをまとめて破棄します。

```
ユーザーが「解放」をクリック
  ↓ dirty なら confirm（未保存確認）
  ↓ releaseBackend()
      ├ sheet.close()     … Virtualizer / DOM / 行キャッシュ解除
      ├ csvClose()        … invoke("csv_close") 引数なし
      └ unlistenIndexEvents()
  ↓ path / meta / dirty をクリア、メタ表示を「未選択」に
```

- **保存済み**（`dirty === false`）: 上記のとおり完全解放
- **未保存**（`dirty === true`）: 確認ダイアログ後に同じく完全解放（編集内容は破棄）
- ファイル未選択時: ボタンは無効

### 解放が走るタイミング（一覧）

| 操作 | フロント | Rust `csv_close` | 備考 |
|------|----------|------------------|------|
| **「解放」ボタン** | `releaseBackend()` | ✅ 全セッション | 意図した明示解放 |
| **保存済みでモード切替**（Markdown 等へ） | `deactivate` → `releaseBackend()` | ✅ | |
| **未保存でモード切替** | `sheet.close` + `unlisten` のみ | ❌ セッション保持 | `backendLoaded` も **true のまま**（再表示時は `csv_open` 不要） |
| **別ファイルを開く** | 旧ファイル `csvClose` 後 `csv_open` | ✅（open 前） | `loadFile` 内 |
| **`csv_open`（新規）** | — | 既存を `drop_session_memory` して clear | 新セッション 1 件だけ insert |

### Rust：`csv_close` の処理順

`csv_close` は **パス引数なし**。常に **登録済みの全 CSV セッション** を対象にします（将来の拡張に備えた API 形状）。

```rust
pub fn csv_close(state: tauri::State<CsvState>) -> Result<(), String> {
    invalidate_all_sessions(&mut reg);
    Ok(())
}
```

`invalidate_all_sessions` の内部:

```
1. SESSION_EPOCH += 1
     → 走行中の索引スレッドが should_continue / index_build_still_valid で false になる
2. 各 CsvSession に drop_session_memory()
3. sessions.clear()
4. trim_process_heap()   … macOS のみ（後述）
```

#### `drop_session_memory`（セッション単位）

| `LoadMode` | 解放内容 |
|------------|----------|
| `InMemory` | `overrides.clear()`、`rows.clear()` + `rows.shrink_to_fit()` |
| `Streaming` | `overrides.clear()`、`row_cache.clear()`（48MB LRU 全破棄）、`index.checkpoints.clear()` + `shrink_to_fit()`、`total_rows = None` |

`shrink_to_fit()` は **Rust ヒープ上の Vec 容量** を OS へ返すよう **依頼** するだけで、RSS 低下を保証しません。

#### `SESSION_EPOCH` と索引スレッド

```
csv_open
  epoch = SESSION_EPOCH.fetch_add(1)   // この open 用の世代
  spawn_index_build(..., epoch)        // 100MB 超 & 索引キャッシュなしのとき

csv_close / invalidate_all_sessions
  SESSION_EPOCH += 1                   // 以降のスレッドは「無効」

索引スレッド内
  build_index_from_file(..., || index_build_still_valid(app, path, epoch), ...)
    → 1 MiB 読み込み / 1 万行ごとにチェック
    → false なら Err("索引構築がキャンセルされました") で終了
  完了後も index_build_still_valid が false なら
    → セッション更新・csv-index-ready イベントを送らない
```

`csv_open` で別ファイルを開くときは **invalidate は呼ばない**（`drop_session_memory` + `clear` のみ）。旧スレッドはセッション削除により `index_build_still_valid` が false になり、同様に停止します。

#### macOS：`trim_process_heap`

```rust
#[cfg(target_os = "macos")]
fn trim_process_heap() {
    malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
}
```

Apple の malloc は解放済みページを **プロセス内にキャッシュ** しがちです。`malloc_zone_pressure_relief` は OS への返却を **促す** ものですが、Activity Monitor の数値が即座に下がるとは限りません。Linux / Windows では現状 no-op（将来必要なら `malloc_trim` 等を検討）。

### フロント：`releaseBackend` の処理順

`editor.ts` の `releaseBackend()`:

1. `unlistenIndexEvents()` … `csv-index-progress` / `csv-index-ready` の購読解除
2. 索引進捗 UI を非表示
3. `await sheet.close()` … 下表
4. `backendLoaded || path !== null` なら `await csvClose()`
5. `backendLoaded = false`

#### `spreadsheet.ts` の `close()`

| 処理 | 目的 |
|------|------|
| `loadGeneration += 1` | 進行中の `csv_read_rows` 結果を破棄 |
| Virtualizer / scroll リスナー / prefetch タイマー解除 | DOM・イベントの常駐を止める |
| `rowCache.clear()`（最大 400 行 LRU） | WebView 側の行文字列キャッシュ |
| `thead` / `tbody` の `replaceChildren()` | 表 DOM を空に |

### プロセス全体のメモリ内訳

Karasu（Tauri）は **1 プロセス** です。Activity Monitor で見える RSS には次が **すべて含まれます**。

```
┌─────────────────────────────────────────────────┐
│  Karasu プロセス RSS                             │
├─────────────────────────────────────────────────┤
│  WKWebView … JS ヒープ、DOM、TanStack、CSS 等    │
│  Rust … CSV セッション、索引構築の一時バッファ    │
│  フレームワーク … Tauri、システムライブラリ       │
│  malloc キャッシュ … 解放済みだが OS 未返却       │
└─────────────────────────────────────────────────┘
```

そのため **「解放」後に Rust セッションだけ消えても RSS は大きく動かない** ことが普通です。特に:

- **43 MB 級 CSV** はメモリモード → Rust で数百 MB 級になることもあるが、WebView も同程度持ちうる
- **解放直後** は malloc キャッシュが残る
- **Markdown モードに切替** しても WebView 自体は生きている

### Activity Monitor で RSS が減らないとき

| 現象 | 説明 | 確認方法 |
|------|------|----------|
| 数値がほぼ不变 | 論理解放 ≠ RSS 即減少。正常なことが多い | 同じ CSV を再度「開く」→ 問題なければセッションは消えている |
| 解放前より高いまま | 起動直後のベース + WebView + 他モードの資産 | CSV モードに入る前と比較する |
| 索引構築中に解放 | スレッドはキャンセルされるが、スレッドスタック / 一時 `carry` は drop まで残る | 数秒待ってから再観測 |
| 未保存のまま Markdown へ | **意図的に** Rust セッションを保持 | 保存するか「解放」する |

**より正確な計測**（開発者向け）:

- macOS **Instruments → Allocations** で Karasu プロセスのヒープ推移
- 解放 → 同ファイル再オープンで **二重ロード** にならないこと（OOM しないこと）

### よくある質問

**Q. Rust 側、解放し忘れていませんか？**  
A. `csv_close` → `invalidate_all_sessions` → `drop_session_memory` でセッション内の主要データは破棄します。索引スレッドも epoch / `should_continue` で止めます。

**Q. それでも RSS が下がらないのはバグ？**  
A. 多くの場合 **macOS のメモリ accounting と allocator キャッシュ** による見かけの問題です。機能として「同じファイルを再度開ける」「別 CSV に切替できる」ことが重要で、RSS の即時低下は保証しません。

**Q. メモリを確実に抑えたい**  
A. 100 MB 未満でもメモリモードになる点に注意。閾値 `MEMORY_THRESHOLD` を下げてストリーミング優先にする、または巨大 CSV を開いたら作業後に **「解放」** またはアプリ終了、が現実的な運用です（閾値変更は [`design-decisions.md`](design-decisions.md) と本書の定数表を同期すること）。

**Q. 索引 JSON は解放される？**  
A. **ディスク上** に残ります（次回オープン高速化用）。Rust ヒープから外すのはセッション内の `CheckpointIndex` と構築中バッファです。ディスクキャッシュ削除 API は未実装。

**Q. dirty のまま Markdown に移ったあと**  
A. **意図的に** Rust セッション（`overrides` 含む）と `backendLoaded === true` を維持します。CSV モードに戻ると `ensureVisible` → `sheet.open(path, meta)` で **UI だけ再構築** し、未保存編集は Rust から読み出せます。  
⚠️ この状態で `csv_open` が再度走ると（`reopenIfNeeded` 経由など `backendLoaded === false` のとき）セッションは **新規作成** され `overrides` は消えます。保存済みにしてからモード切替するか、CSV モードのまま作業するのが安全です。

**Q. 起動時に recent CSV を自動で開く？**  
A. **`getEditorMode() === "csv"` のときだけ** `restoreRecentOnStartup` が動きます。Markdown 等で起動した場合、巨大 CSV を勝手に読み込みません。

### 開発者向け：解放漏れチェックリスト

1. 新しい CSV 関連の非同期処理に **`loadGeneration` / `epoch`** 相当の無効化があるか
2. Tauri イベント listen 後、必ず **`unlisten`**（`editor.ts` の `unlistenIndexEvents` パターン）
3. UI 破棄時に **`sheet.close()`** を await
4. Rust でセッション外の static に巨大データを載せない
5. `csv_close` に path を復活させない（全セッション clear が正本）
6. 索引構築ループに **協調的キャンセル** を入れる（`build_index_from_file` の `should_continue` パターン）

---

## 保存の挙動

- **明示保存のみ**（他エディタと同様、自動保存なし）
- 保存処理は行単位で全行を読み、オーバーライドを適用し、一時ファイル（`.karasu-tmp`）へ書き出してから `rename`
- 100MB 以下のメモリモード: 保存後に InMemory の `rows` を再構築
- 1TB 級でも **理論上は可能** だが、保存は全行走査のため **時間がかかる**（進捗 UI は未実装）

---

## UI 表示（ツールバー）

| 要素 | 説明 |
|------|------|
| 開く / 保存 / 別名で保存 | 他エディタと同様のファイル操作 |
| **解放**（`#btn-csv-close`） | 開いている CSV を閉じ、Rust セッションとフロントキャッシュを破棄。詳細は [メモリ管理と解放](#メモリ管理と解放) |
| `#csv-meta` | ファイルサイズ・行数・列数・モード・索引状態 |

`#csv-meta` の表示例:

```
43.5 MB · 541,911 行 · 8 列 · メモリ · 索引済
                              ↑        ↑
                         streaming なら「ストリーミング」
                                    index_ready なら「索引済」
```

100MB 超で索引未完成時は `#csv-index-progress` に進捗バーを表示。

---

## 制限・スコープ外

| 項目 | 状態 |
|------|------|
| 行・列の挿入 / 削除 | 未対応 |
| ソート・フィルタ・列固定 | 未対応（Table Core 拡張余地あり） |
| 数式・書式・複数シート | 非対象 |
| TSV と CSV の区切り自動判定 | 現状はカンマ区切り parser 固定（`.tsv` も同じ） |
| 外部変更の監視 | 未対応（ファイル監視は Markdown 作業フォルダ向け） |
| 全行を文字列としてエクスポート API | 巨大ファイルでは非提供 |

---

## 依存パッケージ

| パッケージ | 用途 |
|------------|------|
| `@tanstack/virtual-core` | 行仮想化（ヘッドレス） |
| `@tanstack/table-core` | 列ヘッダー定義 |

React 版（`@tanstack/react-virtual` 等）は **採用しない**（Vanilla 方針）。

---

## 開発者向け：変更時のチェックリスト

1. **100MB 閾値**を変える場合は `MEMORY_THRESHOLD` と本ドキュメントを同期
2. フロント row キャッシュと Rust `ROW_CACHE_MAX_BYTES` のバランス（フロントは行数、Rust はバイト）
3. `createTable` に空 `state` を渡さない（`initialState` 適用必須）
4. `<tr>` に `position: absolute` を戻さない
5. 新 Tauri コマンドは `lib.rs` の `invoke_handler` と `capabilities` を更新
6. モード切替・ファイル切替で `csv_close` / `unlisten` / `sheet.close` の漏れがないか確認（[解放漏れチェックリスト](#開発者向け解放漏れチェックリスト)）
7. 設計判断を変えたら [`design-decisions.md`](design-decisions.md) のバックログも更新

---

## 関連ドキュメント

- [design-decisions.md](design-decisions.md) … 全体の設計判断・性能優先順位
- [README.md](README.md) … ドキュメント索引
- [TanStack Virtual Table 例](https://tanstack.com/virtual/v3/docs/framework/react/examples/table) … 行 `translateY` の参考（React だが配置ロジックは同じ）

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-06-11 | 初版（CSV モード・ストリーミング・仮想化・解放方針） |
| 2026-06-11 | メモリ管理と解放を大幅追記（解放ボタン、`csv_close` 引数なし、epoch、RSS、FAQ） |

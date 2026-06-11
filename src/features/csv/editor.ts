import { getEditorMode } from "../../app/editor-mode";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { EditorController, EditorHost } from "../../core/editor-controller";
import { csvClose, csvOpen, csvSave, type CsvOpenResult } from "./api";
import { CsvSpreadsheet } from "./spreadsheet";

const CSV_FILTERS = [{ name: "CSV", extensions: ["csv", "tsv"] }];
const CSV_EXTENSIONS = [".csv", ".tsv"];

function fileBaseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function isCsvPath(path: string): boolean {
  const lower = path.toLowerCase();
  return CSV_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isModKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function createCsvEditor(host: EditorHost): EditorController {
  const screen = document.querySelector("#csv-screen") as HTMLElement;
  const scrollEl = document.querySelector("#csv-scroll") as HTMLElement;
  const innerEl = document.querySelector("#csv-table-inner") as HTMLElement;
  const tableEl = document.querySelector("#csv-table") as HTMLTableElement;
  const theadEl = document.querySelector("#csv-thead") as HTMLTableSectionElement;
  const tbodyEl = document.querySelector("#csv-tbody") as HTMLTableSectionElement;
  const progressWrap = document.querySelector("#csv-index-progress") as HTMLElement;
  const progressBar = document.querySelector("#csv-index-progress-bar") as HTMLProgressElement;
  const progressLabel = document.querySelector("#csv-index-progress-label") as HTMLElement;
  const metaEl = document.querySelector("#csv-meta") as HTMLElement;
  const btnClose = document.querySelector("#btn-csv-close") as HTMLButtonElement;

  let path: string | null = null;
  let dirty = false;
  let active = false;
  let meta: CsvOpenResult | null = null;
  let unlistenProgress: (() => void) | null = null;
  let unlistenReady: (() => void) | null = null;
  let backendLoaded = false;

  const sheet = new CsvSpreadsheet({
    scrollEl,
    innerEl,
    tableEl,
    theadEl,
    tbodyEl,
    onDirty: () => {
      dirty = true;
      syncStatus();
    },
    onError: (message) => host.showError(message),
  });

  const syncStatus = () => {
    host.setStatus({
      path,
      fileName: path ? fileBaseName(path) : "未選択",
      dirty,
    });
    syncCloseButton();
  };

  function syncCloseButton(): void {
    btnClose.disabled = path === null;
  }

  function updateMetaDisplay() {
    if (!meta) {
      metaEl.textContent = "";
      return;
    }
    const mode = meta.streaming ? "ストリーミング" : "メモリ";
    const index = meta.index_ready ? "索引済" : "索引構築中";
    metaEl.textContent = `${formatBytes(meta.file_size)} · ${meta.row_count.toLocaleString()} 行 · ${meta.column_count} 列 · ${mode} · ${index}`;
  }

  function showIndexProgress(rows: number, done: boolean) {
    progressWrap.hidden = done;
    if (done) {
      progressBar.removeAttribute("value");
      progressLabel.textContent = "";
      return;
    }
    progressBar.removeAttribute("max");
    progressBar.value = rows;
    progressLabel.textContent = `索引構築中… ${rows.toLocaleString()} 行`;
  }

  function unlistenIndexEvents(): void {
    unlistenProgress?.();
    unlistenProgress = null;
    unlistenReady?.();
    unlistenReady = null;
  }

  async function releaseBackend(): Promise<void> {
    unlistenIndexEvents();
    progressWrap.hidden = true;
    progressBar.removeAttribute("value");
    progressLabel.textContent = "";
    await sheet.close();
    if (backendLoaded || path !== null) {
      await csvClose();
    }
    backendLoaded = false;
  }

  async function bindIndexEvents(filePath: string) {
    unlistenIndexEvents();
    unlistenProgress = await listen<{ path: string; rows: number; done: boolean }>(
      "csv-index-progress",
      (event) => {
        if (!active || event.payload.path !== filePath) return;
        showIndexProgress(event.payload.rows, event.payload.done);
      },
    );
    unlistenReady = await listen<{ path: string; row_count: number }>(
      "csv-index-ready",
      (event) => {
        if (!active || event.payload.path !== filePath || !meta) return;
        meta.row_count = event.payload.row_count;
        meta.index_ready = true;
        showIndexProgress(event.payload.row_count, true);
        sheet.setRowCount(event.payload.row_count);
        updateMetaDisplay();
      },
    );
  }

  async function loadFile(filePath: string) {
    if (path && path !== filePath && backendLoaded) {
      await csvClose();
    }
    await sheet.close();
    unlistenIndexEvents();
    const result = await csvOpen(filePath);
    path = result.path;
    meta = result;
    dirty = result.dirty;
    await sheet.open(result.path, result);
    backendLoaded = true;
    updateMetaDisplay();
    if (result.streaming && !result.index_ready) {
      showIndexProgress(0, false);
      void bindIndexEvents(result.path);
    } else {
      progressWrap.hidden = true;
    }
    host.clearError();
    syncStatus();
  }

  async function reopenIfNeeded(): Promise<void> {
    if (!path || !meta) return;
    try {
      const result = await csvOpen(path);
      meta = result;
      dirty = result.dirty;
      await sheet.open(result.path, result);
      backendLoaded = true;
      updateMetaDisplay();
      if (result.streaming && !result.index_ready) {
        showIndexProgress(0, false);
        void bindIndexEvents(result.path);
      }
      syncStatus();
    } catch (e) {
      host.showError(String(e));
    }
  }

  async function ensureVisible(): Promise<void> {
    if (!path || !meta) {
      sheet.remeasure();
      return;
    }
    if (!backendLoaded) {
      await reopenIfNeeded();
      return;
    }
    await sheet.open(path, meta);
  }

  function confirmDiscard(): boolean {
    if (!dirty) return true;
    return window.confirm(
      "未保存の変更があります。破棄して別のファイルを開きますか？",
    );
  }

  function confirmClose(): boolean {
    if (!dirty) return true;
    return window.confirm(
      "未保存の変更があります。ファイルを閉じてメモリを解放しますか？",
    );
  }

  async function closeCurrentFile(): Promise<void> {
    if (!path) return;
    if (!confirmClose()) return;
    await releaseBackend();
    path = null;
    meta = null;
    dirty = false;
    updateMetaDisplay();
    host.clearError();
    syncStatus();
  }

  btnClose.addEventListener("click", () => void closeCurrentFile());

  return {
    activate() {
      active = true;
      screen.hidden = false;
      void ensureVisible();
      syncStatus();
    },

    deactivate() {
      active = false;
      screen.hidden = true;
      // 未保存の編集は Rust セッションに残っているため、dirty 時は解放しない
      if (!dirty) {
        void releaseBackend();
      } else {
        unlistenIndexEvents();
        void sheet.close();
      }
    },

    async suspend() {
      active = false;
      screen.hidden = true;
      await releaseBackend();
      path = null;
      meta = null;
      dirty = false;
      updateMetaDisplay();
      host.clearError();
      syncStatus();
    },

    isDirty: () => dirty,
    getPath: () => path,
    getFileName: () => (path ? fileBaseName(path) : "未選択"),

    async openFileWithGuard(filePath: string) {
      if (!confirmDiscard()) return;
      try {
        await loadFile(filePath);
      } catch (e) {
        host.showError(String(e));
      }
    },

    async openFileDialog() {
      const selected = await open({
        multiple: false,
        filters: CSV_FILTERS,
      });
      if (selected === null || Array.isArray(selected)) return;
      const picked =
        typeof selected === "string"
          ? selected
          : (selected as { path: string }).path;
      await this.openFileWithGuard(picked);
    },

    async save() {
      if (!path) {
        host.showError("保存先のファイルがありません。先にファイルを開いてください。");
        return;
      }
      try {
        const savedPath = await csvSave(path);
        path = savedPath;
        dirty = false;
        backendLoaded = true;
        host.clearError();
        syncStatus();
      } catch (e) {
        host.showError(String(e));
      }
    },

    async saveAs() {
      if (!path) {
        host.showError("保存先のファイルがありません。先にファイルを開いてください。");
        return;
      }
      const selected = await save({
        filters: CSV_FILTERS,
        defaultPath: path,
      });
      if (selected === null) return;
      const picked =
        typeof selected === "string"
          ? selected
          : (selected as { path: string }).path;
      try {
        const savedPath = await csvSave(path, picked);
        path = savedPath;
        dirty = false;
        syncStatus();
        host.clearError();
      } catch (e) {
        host.showError(String(e));
      }
    },

    handleShortcut(e: KeyboardEvent): boolean {
      if (!active || !isModKey(e)) return false;
      const key = e.key.toLowerCase();
      if (key === "s" && e.shiftKey) {
        void this.saveAs();
        return true;
      }
      if (key === "s") {
        void this.save();
        return true;
      }
      if (key === "o") {
        void this.openFileDialog();
        return true;
      }
      return false;
    },

    async restoreRecentOnStartup() {
      if (getEditorMode() !== "csv") return;
      const paths = await invoke<string[]>("get_recent_paths");
      const recent = paths.find(isCsvPath);
      if (!recent) return;
      try {
        await loadFile(recent);
      } catch (e) {
        host.showError(`最近の CSV ファイルを開けませんでした: ${e}`);
      }
    },

    syncUi() {
      syncStatus();
      updateMetaDisplay();
      syncCloseButton();
    },

    persistScroll() {},
  };
}

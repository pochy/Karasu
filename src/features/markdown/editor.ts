import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { EditorController, EditorHost } from "../../core/editor-controller";
import { renderMermaidIn } from "./preview/mermaid-preview";
import { invalidatePreviewCache, renderMarkdownToHtml } from "./preview/markdown";
import {
  getFileWatchEnabled,
  onFileWatchSettingChange,
} from "../settings/settings";
import {
  restoreScrollPosition,
  saveScrollPosition,
} from "../../core/session-state";
import { toggleSidebar } from "./sidebar/layout";
import { initSidebar, type SidebarControls } from "./sidebar/sidebar";

type ViewMode = "edit" | "preview";

interface FileContent {
  path: string;
  content: string;
}

const MARKDOWN_FILTERS = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd", "txt"],
  },
];

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".txt"];

function fileBaseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isModKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

export function createMarkdownEditor(host: EditorHost): EditorController {
  const screen = document.querySelector("#markdown-screen") as HTMLElement;
  const editor = document.querySelector("#editor") as HTMLTextAreaElement;
  const preview = document.querySelector("#preview") as HTMLElement;
  const btnToggleView = document.querySelector("#btn-toggle-view") as HTMLButtonElement;

  let path: string | null = null;
  let content = "";
  let savedContent = "";
  let view: ViewMode = "edit";
  let savedSelection: { start: number; end: number } | null = null;
  let lastRenderedPreviewContent: string | null = null;
  let sidebarControls: SidebarControls | null = null;
  let active = false;

  const isDirty = () => content !== savedContent;

  const syncStatus = () => {
    host.setStatus({
      path,
      fileName: path ? fileBaseName(path) : "未選択",
      dirty: isDirty(),
    });
  };

  async function syncWorkspaceWatch() {
    const root = sidebarControls?.getWorkspaceRoot() ?? null;
    await invoke("set_workspace_watch", {
      enabled: getFileWatchEnabled(),
      path: root,
    });
  }

  async function renderPreview() {
    if (lastRenderedPreviewContent === content) return;
    try {
      preview.innerHTML = renderMarkdownToHtml(content);
      await renderMermaidIn(preview);
      lastRenderedPreviewContent = content;
      host.clearError();
    } catch {
      host.showError("Markdown の変換に失敗しました");
    }
  }

  function applyView() {
    const editing = view === "edit";
    editor.hidden = !editing;
    preview.hidden = editing;
    btnToggleView.textContent = editing ? "プレビュー" : "編集";
    btnToggleView.setAttribute(
      "aria-label",
      editing ? "プレビュー表示に切り替え" : "編集画面に切り替え",
    );
    if (!editing) {
      void renderPreview().then(() => {
        if (path) restoreScrollPosition(path, editor, preview);
      });
    } else if (savedSelection) {
      const { start, end } = savedSelection;
      savedSelection = null;
      requestAnimationFrame(() => {
        editor.focus();
        editor.setSelectionRange(start, end);
        if (path) restoreScrollPosition(path, editor, preview);
      });
    }
  }

  function syncEditorFromState() {
    if (editor.value !== content) editor.value = content;
    syncStatus();
    applyView();
  }

  function persistScroll() {
    if (!path) return;
    saveScrollPosition(path, editor.scrollTop, preview.scrollTop);
  }

  async function loadFile(filePath: string) {
    persistScroll();
    const result = await invoke<FileContent>("read_file", { path: filePath });
    path = result.path;
    content = result.content;
    savedContent = result.content;
    invalidatePreviewCache();
    lastRenderedPreviewContent = null;
    syncEditorFromState();
    host.clearError();
    await sidebarControls?.highlightActiveFile();
    await sidebarControls?.refreshRecentList();
    if (path) restoreScrollPosition(path, editor, preview);
  }

  function confirmDiscard(): boolean {
    if (!isDirty()) return true;
    return window.confirm(
      "未保存の変更があります。破棄して別のファイルを開きますか？",
    );
  }

  function toggleView() {
    if (view === "edit") {
      savedSelection = {
        start: editor.selectionStart,
        end: editor.selectionEnd,
      };
    } else {
      invalidatePreviewCache();
    }
    view = view === "edit" ? "preview" : "edit";
    applyView();
  }

  editor.addEventListener("input", () => {
    content = editor.value;
    invalidatePreviewCache();
    syncStatus();
  });

  btnToggleView.addEventListener("click", toggleView);

  preview.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("a");
    if (!target || !(target instanceof HTMLAnchorElement)) return;
    const href = target.getAttribute("href");
    if (!href || (!href.startsWith("http://") && !href.startsWith("https://"))) {
      return;
    }
    e.preventDefault();
    void openUrl(href);
  });

  onFileWatchSettingChange(() => {
    void syncWorkspaceWatch();
  });

  sidebarControls = initSidebar({
    getActivePath: () => path,
    isDirty,
    openFile: async (filePath: string) => {
      if (!confirmDiscard()) return;
      try {
        await loadFile(filePath);
      } catch (e) {
        host.showError(String(e));
      }
    },
    getFileWatchEnabled,
    onWorkspaceChanged: () => {
      void syncWorkspaceWatch();
    },
  });

  return {
    activate() {
      active = true;
      screen.hidden = false;
      btnToggleView.hidden = false;
      if (sidebarControls?.getWorkspaceRoot() === null) {
        void sidebarControls?.restoreFromDisk();
      }
      syncEditorFromState();
      void sidebarControls?.highlightActiveFile();
      void sidebarControls?.refreshRecentList();
    },

    deactivate() {
      active = false;
      persistScroll();
      screen.hidden = true;
      btnToggleView.hidden = true;
    },

    async suspend() {
      if (path) persistScroll();
      await invoke("set_workspace_watch", { enabled: false, path: null });
      active = false;
      screen.hidden = true;
      btnToggleView.hidden = true;
      editor.value = "";
      preview.replaceChildren();
      content = "";
      savedContent = "";
      path = null;
      savedSelection = null;
      lastRenderedPreviewContent = null;
      invalidatePreviewCache();
      await sidebarControls?.suspend();
      syncStatus();
    },

    isDirty,
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
        filters: MARKDOWN_FILTERS,
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
        await invoke("write_file", { path, content });
        savedContent = content;
        syncStatus();
        host.clearError();
        await sidebarControls?.refreshRecentList();
      } catch (e) {
        host.showError(String(e));
        syncStatus();
      }
    },

    async saveAs() {
      const selected = await save({
        filters: MARKDOWN_FILTERS,
        defaultPath: path ?? undefined,
      });
      if (selected === null) return;
      const picked =
        typeof selected === "string"
          ? selected
          : (selected as { path: string }).path;
      try {
        await invoke("write_file", { path: picked, content });
        path = picked;
        savedContent = content;
        invalidatePreviewCache();
        lastRenderedPreviewContent = null;
        syncEditorFromState();
        host.clearError();
        await sidebarControls?.highlightActiveFile();
        await sidebarControls?.refreshRecentList();
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
      if (key === "o" && e.shiftKey) {
        void sidebarControls?.pickWorkspaceFolder();
        return true;
      }
      if (key === "o") {
        void this.openFileDialog();
        return true;
      }
      if (key === "p") {
        toggleView();
        return true;
      }
      if (key === "b" && !e.shiftKey) {
        toggleSidebar();
        return true;
      }
      return false;
    },

    async restoreRecentOnStartup() {
      const paths = await invoke<string[]>("get_recent_paths");
      const recent = paths.find(isMarkdownPath);
      if (!recent) return;
      try {
        await loadFile(recent);
      } catch (e) {
        host.showError(`最近のファイルを開けませんでした: ${e}`);
      }
    },

    syncUi() {
      syncEditorFromState();
    },

    persistScroll,
  };
}

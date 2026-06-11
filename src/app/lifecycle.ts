import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getEditorMode,
  onEditorModeChange,
  type EditorMode,
} from "./editor-mode";
import type { EditorController } from "../core/editor-controller";
import { editorModeForPath } from "../core/file-kind";

const ALL_MODES: EditorMode[] = ["markdown", "json", "csv"];

export interface LifecycleDeps {
  getControllers(): Record<EditorMode, EditorController>;
  getActiveMode(): EditorMode;
  switchMode(mode: EditorMode): void;
  showError(message: string): void;
  clearError(): void;
}

function anyDirty(controllers: Record<EditorMode, EditorController>): boolean {
  return ALL_MODES.some((mode) => controllers[mode].isDirty());
}

async function suspendAll(controllers: Record<EditorMode, EditorController>): Promise<void> {
  for (const mode of ALL_MODES) {
    await controllers[mode].suspend();
  }
}

async function hideToTray(deps: LifecycleDeps): Promise<void> {
  const controllers = deps.getControllers();
  try {
    await suspendAll(controllers);
    await invoke("suspend_app_resources");
  } catch (e) {
    console.error("suspend before hide failed:", e);
    deps.showError(`ウィンドウを閉じる前の解放に失敗しました: ${e}`);
  }
  try {
    await invoke("refresh_tray_menu");
  } catch (e) {
    console.error("refresh_tray_menu failed:", e);
  }
  try {
    await getCurrentWindow().hide();
  } catch (e) {
    console.error("window.hide failed:", e);
    deps.showError(`ウィンドウを非表示にできません: ${e}`);
  }
}

function confirmHideWithDirty(): boolean {
  return window.confirm(
    "未保存の変更があります。ウィンドウを閉じてメモリを解放しますか？\nアプリはメニューバーに残ります。",
  );
}

async function openFileFromTray(
  deps: LifecycleDeps,
  filePath: string,
): Promise<void> {
  const mode = editorModeForPath(filePath);
  if (getEditorMode() !== mode) {
    deps.switchMode(mode);
  }
  await deps.getControllers()[mode].openFileWithGuard(filePath);
  await invoke("refresh_tray_menu");
}

export function initAppLifecycle(deps: LifecycleDeps): void {
  void getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    const controllers = deps.getControllers();
    if (anyDirty(controllers) && !confirmHideWithDirty()) {
      return;
    }
    await hideToTray(deps);
  });

  void listen<string>("tray-open-file", (event) => {
    void openFileFromTray(deps, event.payload);
  });

  void listen<string>("tray-error", (event) => {
    deps.showError(event.payload);
  });

  onEditorModeChange(() => {
    deps.clearError();
  });
}

export async function refreshTrayMenuAfterFileChange(): Promise<void> {
  await invoke("refresh_tray_menu");
}

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { EditorController, EditorHost } from "../core/editor-controller";

function fileBaseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function createAppChrome(getActive: () => EditorController): EditorHost {
  const fileNameEl = document.querySelector("#file-name") as HTMLElement;
  const filePathEl = document.querySelector("#file-path") as HTMLElement;
  const saveStatusEl = document.querySelector("#save-status") as HTMLElement;
  const errorBanner = document.querySelector("#error-banner") as HTMLElement;
  const btnOpen = document.querySelector("#btn-open") as HTMLButtonElement;
  const btnSaveAs = document.querySelector("#btn-save-as") as HTMLButtonElement;

  const host: EditorHost = {
    showError(message: string) {
      errorBanner.textContent = message;
      errorBanner.hidden = false;
    },
    clearError() {
      errorBanner.textContent = "";
      errorBanner.hidden = true;
    },
    setStatus({ path, fileName, dirty }) {
      fileNameEl.textContent = fileName;
      if (!path) {
        filePathEl.hidden = true;
        filePathEl.textContent = "";
        filePathEl.removeAttribute("title");
      } else {
        filePathEl.hidden = false;
        filePathEl.textContent = path;
        filePathEl.title = path;
      }
      saveStatusEl.textContent = dirty ? "未保存" : "保存済み";
      saveStatusEl.classList.toggle("save-status--unsaved", dirty);
      saveStatusEl.classList.toggle("save-status--saved", !dirty);

      const appWindow = getCurrentWebviewWindow();
      const prefix = dirty ? "• " : "";
      const titleName = path ? fileBaseName(path) : fileName;
      void appWindow.setTitle(`${prefix}${titleName} - Karasu`);
    },
  };

  btnOpen.addEventListener("click", () => void getActive().openFileDialog());
  btnSaveAs.addEventListener("click", () => void getActive().saveAs());

  window.addEventListener("keydown", (e) => {
    if (getActive().handleShortcut(e)) {
      e.preventDefault();
    }
  });

  return host;
}

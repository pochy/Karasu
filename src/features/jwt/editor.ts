import { decodeJwt } from "../../core/jwt-decode";
import type { EditorController, EditorHost } from "../../core/editor-controller";

function isModKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatExpiry(expiresAt: Date | null, isExpired: boolean | null): string {
  if (!expiresAt) return "exp クレームなし";
  const local = expiresAt.toLocaleString();
  if (isExpired === null) return local;
  return isExpired ? `${local}（期限切れ）` : `${local}（有効）`;
}

export function createJwtEditor(host: EditorHost): EditorController {
  const screen = document.querySelector("#jwt-screen") as HTMLElement;
  const tokenInput = document.querySelector("#jwt-token") as HTMLTextAreaElement;
  const headerOut = document.querySelector("#jwt-header") as HTMLPreElement;
  const payloadOut = document.querySelector("#jwt-payload") as HTMLPreElement;
  const expiryEl = document.querySelector("#jwt-expiry") as HTMLElement;
  const btnDecode = document.querySelector("#btn-jwt-decode") as HTMLButtonElement;
  const btnClear = document.querySelector("#btn-jwt-clear") as HTMLButtonElement;

  let token = "";
  let baseline = "";
  let active = false;

  const isDirty = () => token !== baseline;

  const syncStatus = () => {
    host.setStatus({
      path: null,
      fileName: "JWT Viewer",
      dirty: isDirty(),
    });
  };

  function renderDecode() {
    const result = decodeJwt(token);
    if (result.error) {
      host.showError(result.error);
      headerOut.textContent = "";
      payloadOut.textContent = "";
      expiryEl.textContent = "";
      return;
    }
    if (!result.parts) {
      headerOut.textContent = "";
      payloadOut.textContent = "";
      expiryEl.textContent = "";
      host.clearError();
      return;
    }
    headerOut.textContent = formatJson(result.parts.header);
    payloadOut.textContent = formatJson(result.parts.payload);
    expiryEl.textContent = formatExpiry(result.expiresAt, result.isExpired);
    host.clearError();
  }

  function syncInput() {
    if (tokenInput.value !== token) tokenInput.value = token;
    syncStatus();
  }

  function decode() {
    renderDecode();
    syncStatus();
  }

  function clearAll() {
    token = "";
    baseline = "";
    tokenInput.value = "";
    headerOut.textContent = "";
    payloadOut.textContent = "";
    expiryEl.textContent = "";
    host.clearError();
    syncStatus();
  }

  tokenInput.addEventListener("input", () => {
    token = tokenInput.value;
    syncStatus();
  });

  btnDecode.addEventListener("click", decode);
  btnClear.addEventListener("click", clearAll);

  return {
    activate() {
      active = true;
      screen.hidden = false;
      syncInput();
    },

    deactivate() {
      active = false;
      screen.hidden = true;
    },

    async suspend() {
      active = false;
      screen.hidden = true;
      token = "";
      baseline = "";
      tokenInput.value = "";
      headerOut.textContent = "";
      payloadOut.textContent = "";
      expiryEl.textContent = "";
      host.clearError();
      syncStatus();
    },

    isDirty,
    getPath: () => null,
    getFileName: () => "JWT Viewer",

    async openFileWithGuard() {},
    async openFileDialog() {},
    async save() {},
    async saveAs() {},

    handleShortcut(e: KeyboardEvent): boolean {
      if (!active || !isModKey(e)) return false;
      const key = e.key.toLowerCase();
      if (key === "enter") {
        decode();
        return true;
      }
      if (key === "k") {
        clearAll();
        return true;
      }
      return false;
    },

    async restoreRecentOnStartup() {},

    syncUi() {
      syncInput();
    },

    persistScroll() {},
  };
}

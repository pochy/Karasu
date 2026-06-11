import type { EditorController, EditorHost } from "../../core/editor-controller";
import {
  buildUrl,
  convertColor,
  convertTimestamp,
  decodeBase64,
  decodeUrl,
  diffText,
  encodeBase64,
  encodeUrl,
  formatDiffLines,
  generateUuid,
  hashText,
  parseUrl,
  testRegexp,
} from "../../core/devtools-utils";

function isModKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function createDevtoolsEditor(host: EditorHost): EditorController {
  const screen = document.querySelector("#devtools-screen") as HTMLElement;

  const base64In = document.querySelector("#devtools-base64-in") as HTMLTextAreaElement;
  const base64Out = document.querySelector("#devtools-base64-out") as HTMLTextAreaElement;
  const urlEncIn = document.querySelector("#devtools-url-enc-in") as HTMLTextAreaElement;
  const urlEncOut = document.querySelector("#devtools-url-enc-out") as HTMLTextAreaElement;
  const hashIn = document.querySelector("#devtools-hash-in") as HTMLTextAreaElement;
  const hashOut = document.querySelector("#devtools-hash-out") as HTMLTextAreaElement;
  const hashAlgo = document.querySelector("#devtools-hash-algo") as HTMLSelectElement;
  const uuidOut = document.querySelector("#devtools-uuid-out") as HTMLInputElement;
  const urlParseIn = document.querySelector("#devtools-url-parse-in") as HTMLInputElement;
  const urlParseOut = document.querySelector("#devtools-url-parse-out") as HTMLPreElement;
  const urlBuildProtocol = document.querySelector("#devtools-url-protocol") as HTMLInputElement;
  const urlBuildHost = document.querySelector("#devtools-url-host") as HTMLInputElement;
  const urlBuildPath = document.querySelector("#devtools-url-path") as HTMLInputElement;
  const urlBuildSearch = document.querySelector("#devtools-url-search") as HTMLInputElement;
  const urlBuildHash = document.querySelector("#devtools-url-hash") as HTMLInputElement;
  const urlBuildOut = document.querySelector("#devtools-url-build-out") as HTMLInputElement;
  const regexpPattern = document.querySelector("#devtools-regexp-pattern") as HTMLInputElement;
  const regexpFlags = document.querySelector("#devtools-regexp-flags") as HTMLInputElement;
  const regexpText = document.querySelector("#devtools-regexp-text") as HTMLTextAreaElement;
  const regexpOut = document.querySelector("#devtools-regexp-out") as HTMLPreElement;
  const timestampIn = document.querySelector("#devtools-timestamp-in") as HTMLInputElement;
  const timestampOut = document.querySelector("#devtools-timestamp-out") as HTMLPreElement;
  const diffLeft = document.querySelector("#devtools-diff-left") as HTMLTextAreaElement;
  const diffRight = document.querySelector("#devtools-diff-right") as HTMLTextAreaElement;
  const diffOut = document.querySelector("#devtools-diff-out") as HTMLPreElement;
  const colorIn = document.querySelector("#devtools-color-in") as HTMLInputElement;
  const colorOut = document.querySelector("#devtools-color-out") as HTMLPreElement;
  const colorSwatch = document.querySelector("#devtools-color-swatch") as HTMLElement;

  let active = false;
  let dirty = false;

  const syncStatus = () => {
    host.setStatus({
      path: null,
      fileName: "開発ツール",
      dirty,
    });
  };

  function markDirty() {
    dirty = true;
    syncStatus();
  }

  function runBase64Encode() {
    const { result, error } = encodeBase64(base64In.value);
    if (error) {
      host.showError(error);
      return;
    }
    base64Out.value = result;
    host.clearError();
    markDirty();
  }

  function runBase64Decode() {
    const { result, error } = decodeBase64(base64In.value);
    if (error) {
      host.showError(error);
      return;
    }
    base64Out.value = result;
    host.clearError();
    markDirty();
  }

  function runUrlEncode() {
    urlEncOut.value = encodeUrl(urlEncIn.value);
    host.clearError();
    markDirty();
  }

  function runUrlDecode() {
    const { result, error } = decodeUrl(urlEncIn.value);
    if (error) {
      host.showError(error);
      return;
    }
    urlEncOut.value = result;
    host.clearError();
    markDirty();
  }

  async function runHash() {
    const algo = hashAlgo.value as "SHA-1" | "SHA-256" | "SHA-512";
    const { result, error } = await hashText(hashIn.value, algo);
    if (error) {
      host.showError(error);
      return;
    }
    hashOut.value = result;
    host.clearError();
    markDirty();
  }

  function runUuid() {
    uuidOut.value = generateUuid();
    host.clearError();
    markDirty();
  }

  function runUrlParse() {
    const { result, error } = parseUrl(urlParseIn.value);
    if (error) {
      host.showError(error);
      urlParseOut.textContent = "";
      return;
    }
    urlParseOut.textContent = result ? JSON.stringify(result, null, 2) : "";
    host.clearError();
    markDirty();
  }

  function runUrlBuild() {
    const { result, error } = buildUrl({
      protocol: urlBuildProtocol.value,
      host: urlBuildHost.value,
      pathname: urlBuildPath.value,
      search: urlBuildSearch.value,
      hash: urlBuildHash.value,
    });
    if (error) {
      host.showError(error);
      return;
    }
    urlBuildOut.value = result;
    host.clearError();
    markDirty();
  }

  function runRegexpTest() {
    const { summary, error } = testRegexp(
      regexpPattern.value,
      regexpFlags.value,
      regexpText.value,
    );
    if (error) {
      host.showError(error);
      regexpOut.textContent = "";
      return;
    }
    regexpOut.textContent = summary;
    host.clearError();
    markDirty();
  }

  function runTimestampConvert() {
    const { result, error } = convertTimestamp(timestampIn.value);
    if (error) {
      host.showError(error);
      timestampOut.textContent = "";
      return;
    }
    if (!result) {
      timestampOut.textContent = "";
      host.clearError();
      return;
    }
    timestampOut.textContent = [
      `ISO:      ${result.iso}`,
      `Local:    ${result.local}`,
      `Unix sec: ${result.unixSec}`,
      `Unix ms:  ${result.unixMs}`,
    ].join("\n");
    host.clearError();
    markDirty();
  }

  function runDiff() {
    const lines = diffText(diffLeft.value, diffRight.value);
    diffOut.textContent = formatDiffLines(lines);
    host.clearError();
    markDirty();
  }

  function runColorConvert() {
    const { result, error } = convertColor(colorIn.value);
    if (error) {
      host.showError(error);
      colorOut.textContent = "";
      colorSwatch.style.background = "transparent";
      return;
    }
    if (!result) {
      colorOut.textContent = "";
      colorSwatch.style.background = "transparent";
      host.clearError();
      return;
    }
    colorOut.textContent = [
      `HEX:   ${result.hex}`,
      `RGB:   ${result.rgb}`,
      `RGBA:  ${result.rgba}`,
    ].join("\n");
    colorSwatch.style.background = result.preview;
    host.clearError();
    markDirty();
  }

  function clearAll() {
    base64In.value = "";
    base64Out.value = "";
    urlEncIn.value = "";
    urlEncOut.value = "";
    hashIn.value = "";
    hashOut.value = "";
    uuidOut.value = "";
    urlParseIn.value = "";
    urlParseOut.textContent = "";
    regexpPattern.value = "";
    regexpFlags.value = "g";
    regexpText.value = "";
    regexpOut.textContent = "";
    timestampIn.value = "";
    timestampOut.textContent = "";
    diffLeft.value = "";
    diffRight.value = "";
    diffOut.textContent = "";
    colorIn.value = "";
    colorOut.textContent = "";
    colorSwatch.style.background = "transparent";
    urlBuildProtocol.value = "https:";
    urlBuildHost.value = "";
    urlBuildPath.value = "/";
    urlBuildSearch.value = "";
    urlBuildHash.value = "";
    urlBuildOut.value = "";
    dirty = false;
    host.clearError();
    syncStatus();
  }

  document.querySelector("#btn-base64-encode")?.addEventListener("click", runBase64Encode);
  document.querySelector("#btn-base64-decode")?.addEventListener("click", runBase64Decode);
  document.querySelector("#btn-url-encode")?.addEventListener("click", runUrlEncode);
  document.querySelector("#btn-url-decode")?.addEventListener("click", runUrlDecode);
  document.querySelector("#btn-hash")?.addEventListener("click", () => void runHash());
  document.querySelector("#btn-uuid")?.addEventListener("click", runUuid);
  document.querySelector("#btn-uuid-copy")?.addEventListener("click", () => {
    if (!uuidOut.value) return;
    void copyText(uuidOut.value);
  });
  document.querySelector("#btn-url-parse")?.addEventListener("click", runUrlParse);
  document.querySelector("#btn-url-build")?.addEventListener("click", runUrlBuild);
  document.querySelector("#btn-url-build-copy")?.addEventListener("click", () => {
    if (!urlBuildOut.value) return;
    void copyText(urlBuildOut.value);
  });
  document.querySelector("#btn-devtools-clear")?.addEventListener("click", clearAll);
  document.querySelector("#btn-regexp-test")?.addEventListener("click", runRegexpTest);
  document.querySelector("#btn-timestamp-convert")?.addEventListener("click", runTimestampConvert);
  document.querySelector("#btn-diff")?.addEventListener("click", runDiff);
  document.querySelector("#btn-color-convert")?.addEventListener("click", runColorConvert);

  for (const el of [
    base64In,
    urlEncIn,
    hashIn,
    urlParseIn,
    regexpPattern,
    regexpFlags,
    regexpText,
    timestampIn,
    diffLeft,
    diffRight,
    colorIn,
    urlBuildProtocol,
    urlBuildHost,
    urlBuildPath,
    urlBuildSearch,
    urlBuildHash,
  ]) {
    el.addEventListener("input", markDirty);
  }

  return {
    activate() {
      active = true;
      screen.hidden = false;
      syncStatus();
    },

    deactivate() {
      active = false;
      screen.hidden = true;
    },

    async suspend() {
      active = false;
      screen.hidden = true;
      clearAll();
    },

    isDirty: () => dirty,
    getPath: () => null,
    getFileName: () => "開発ツール",

    async openFileWithGuard() {},
    async openFileDialog() {},
    async save() {},
    async saveAs() {},

    handleShortcut(e: KeyboardEvent): boolean {
      if (!active || !isModKey(e)) return false;
      if (e.key.toLowerCase() === "k") {
        clearAll();
        return true;
      }
      return false;
    },

    async restoreRecentOnStartup() {},

    syncUi() {
      syncStatus();
    },

    persistScroll() {},
  };
}

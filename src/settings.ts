import { invoke } from "@tauri-apps/api/core";
import {
  FALLBACK_FONT_FAMILIES,
  SYSTEM_UI_FAMILY,
  fontFamilyToCss,
  labelForFontFamily,
  migrateLegacyFontId,
} from "./fonts";

const STORAGE_KEY = "karasu-display-settings";

export interface DisplaySettings {
  editorFontFamily: string;
  previewFontFamily: string;
  editorFontSize: number;
  previewFontSize: number;
  editorLightMode: boolean;
  fileWatchEnabled: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  editorFontFamily: "Menlo",
  previewFontFamily: SYSTEM_UI_FAMILY,
  editorFontSize: 15,
  previewFontSize: 18,
  editorLightMode: false,
  fileWatchEnabled: false,
};

let fileWatchListeners: Array<() => void> = [];

export function getFileWatchEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as Partial<DisplaySettings>;
    return Boolean(data.fileWatchEnabled);
  } catch {
    return false;
  }
}

export function onFileWatchSettingChange(listener: () => void): void {
  fileWatchListeners.push(listener);
}

function notifyFileWatchChange(): void {
  for (const fn of fileWatchListeners) fn();
}

const EDITOR_SIZE_MIN = 10;
const EDITOR_SIZE_MAX = 32;
const PREVIEW_SIZE_MIN = 12;
const PREVIEW_SIZE_MAX = 28;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalize(
  settings: DisplaySettings,
  editorChoices: string[],
  previewChoices: string[],
): DisplaySettings {
  const pick = (family: string, choices: string[]) => {
    if (choices.includes(family)) return family;
    if (choices.length > 0) return choices[0];
    return family;
  };

  return {
    editorFontFamily: pick(settings.editorFontFamily, editorChoices),
    previewFontFamily: pick(settings.previewFontFamily, previewChoices),
    editorFontSize: clamp(
      Math.round(settings.editorFontSize),
      EDITOR_SIZE_MIN,
      EDITOR_SIZE_MAX,
    ),
    previewFontSize: clamp(
      Math.round(settings.previewFontSize),
      PREVIEW_SIZE_MIN,
      PREVIEW_SIZE_MAX,
    ),
    editorLightMode: Boolean(settings.editorLightMode),
    fileWatchEnabled: Boolean(settings.fileWatchEnabled),
  };
}

function parseStored(raw: string): Partial<DisplaySettings> & Record<string, unknown> {
  const data = JSON.parse(raw) as Record<string, unknown>;
  if ("editorFontId" in data || "previewFontId" in data) {
    return {
      editorFontFamily: migrateLegacyFontId(String(data.editorFontId ?? "")),
      previewFontFamily: migrateLegacyFontId(String(data.previewFontId ?? "")),
      editorFontSize: Number(data.editorFontSize),
      previewFontSize: Number(data.previewFontSize),
    };
  }
  return data as Partial<DisplaySettings>;
}

export function loadDisplaySettings(
  editorChoices: string[],
  previewChoices: string[],
): DisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalize({ ...DEFAULT_DISPLAY_SETTINGS }, editorChoices, previewChoices);
    return normalize(
      { ...DEFAULT_DISPLAY_SETTINGS, ...parseStored(raw) },
      editorChoices,
      previewChoices,
    );
  } catch {
    return normalize({ ...DEFAULT_DISPLAY_SETTINGS }, editorChoices, previewChoices);
  }
}

export function saveDisplaySettings(settings: DisplaySettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function applyDisplaySettings(settings: DisplaySettings): void {
  const root = document.documentElement;
  root.style.setProperty(
    "--editor-font-family",
    fontFamilyToCss(settings.editorFontFamily, "editor"),
  );
  root.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
  root.style.setProperty(
    "--preview-font-family",
    fontFamilyToCss(settings.previewFontFamily, "preview"),
  );
  root.style.setProperty("--preview-font-size", `${settings.previewFontSize}px`);
  root.classList.toggle("editor-light", settings.editorLightMode);
}

async function fetchSystemFonts(): Promise<{
  editor: string[];
  preview: string[];
}> {
  try {
    const [mono, all] = await Promise.all([
      invoke<string[]>("list_system_fonts", { monoOnly: true }),
      invoke<string[]>("list_system_fonts", { monoOnly: false }),
    ]);
    const preview = [SYSTEM_UI_FAMILY, ...all];
    const editor = mono.length > 0 ? mono : all.length > 0 ? all : [...FALLBACK_FONT_FAMILIES];
    return { editor, preview };
  } catch {
    const fallback = [...FALLBACK_FONT_FAMILIES];
    return {
      editor: fallback.filter((f) => f !== SYSTEM_UI_FAMILY),
      preview: fallback,
    };
  }
}

function buildFontOptions(
  select: HTMLSelectElement,
  families: string[],
  filter: string,
  selected: string,
) {
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? families.filter((f) => labelForFontFamily(f).toLowerCase().includes(q))
    : families;

  select.replaceChildren();
  for (const family of filtered) {
    const opt = document.createElement("option");
    opt.value = family;
    opt.textContent = labelForFontFamily(family);
    select.appendChild(opt);
  }

  if (filtered.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "該当するフォントがありません";
    empty.disabled = true;
    select.appendChild(empty);
    return;
  }

  if (filtered.includes(selected)) {
    select.value = selected;
  } else {
    select.value = filtered[0];
  }
}

export function initDisplaySettings(): void {
  const overlay = document.querySelector("#settings-overlay") as HTMLElement;
  const dialog = document.querySelector("#settings-dialog") as HTMLElement;
  const btnOpen = document.querySelector("#btn-settings") as HTMLButtonElement;
  const btnClose = document.querySelector(
    "#btn-settings-close",
  ) as HTMLButtonElement;
  const editorFontSelect = document.querySelector(
    "#setting-editor-font",
  ) as HTMLSelectElement;
  const previewFontSelect = document.querySelector(
    "#setting-preview-font",
  ) as HTMLSelectElement;
  const editorFontFilter = document.querySelector(
    "#setting-editor-font-filter",
  ) as HTMLInputElement;
  const previewFontFilter = document.querySelector(
    "#setting-preview-font-filter",
  ) as HTMLInputElement;
  const editorSizeInput = document.querySelector(
    "#setting-editor-size",
  ) as HTMLInputElement;
  const previewSizeInput = document.querySelector(
    "#setting-preview-size",
  ) as HTMLInputElement;
  const editorSizeValue = document.querySelector(
    "#setting-editor-size-value",
  ) as HTMLOutputElement;
  const previewSizeValue = document.querySelector(
    "#setting-preview-size-value",
  ) as HTMLOutputElement;
  const btnReset = document.querySelector(
    "#btn-settings-reset",
  ) as HTMLButtonElement;
  const editorLightCheckbox = document.querySelector(
    "#setting-editor-light",
  ) as HTMLInputElement;
  const fileWatchCheckbox = document.querySelector(
    "#setting-file-watch",
  ) as HTMLInputElement;
  const fontsStatus = document.querySelector(
    "#settings-fonts-status",
  ) as HTMLElement;

  let editorFamilies: string[] = [];
  let previewFamilies: string[] = [];
  let fontsLoaded = false;
  let fontLoadToken = 0;
  let current = { ...DEFAULT_DISPLAY_SETTINGS };
  let lastFocused: HTMLElement | null = null;

  editorSizeInput.min = String(EDITOR_SIZE_MIN);
  editorSizeInput.max = String(EDITOR_SIZE_MAX);
  previewSizeInput.min = String(PREVIEW_SIZE_MIN);
  previewSizeInput.max = String(PREVIEW_SIZE_MAX);

  const syncControls = () => {
    editorSizeInput.value = String(current.editorFontSize);
    previewSizeInput.value = String(current.previewFontSize);
    editorSizeValue.textContent = `${current.editorFontSize}px`;
    previewSizeValue.textContent = `${current.previewFontSize}px`;
    buildFontOptions(
      editorFontSelect,
      editorFamilies,
      editorFontFilter.value,
      current.editorFontFamily,
    );
    buildFontOptions(
      previewFontSelect,
      previewFamilies,
      previewFontFilter.value,
      current.previewFontFamily,
    );
    editorLightCheckbox.checked = current.editorLightMode;
    fileWatchCheckbox.checked = current.fileWatchEnabled;
  };

  const commit = (partial: Partial<DisplaySettings>) => {
    const prevWatch = current.fileWatchEnabled;
    current = normalize(
      { ...current, ...partial },
      editorFamilies,
      previewFamilies,
    );
    applyDisplaySettings(current);
    saveDisplaySettings(current);
    syncControls();
    if (prevWatch !== current.fileWatchEnabled) {
      notifyFileWatchChange();
    }
  };

  const ensureFonts = async () => {
    if (fontsLoaded) return;
    const requestToken = ++fontLoadToken;
    fontsStatus.hidden = false;
    fontsStatus.textContent = "インストール済みフォントを読み込み中…";
    const lists = await fetchSystemFonts();
    if (requestToken !== fontLoadToken || overlay.hidden) {
      return;
    }
    editorFamilies = lists.editor;
    previewFamilies = lists.preview;
    fontsLoaded = true;
    current = loadDisplaySettings(editorFamilies, previewFamilies);
    applyDisplaySettings(current);
    fontsStatus.textContent = `編集 ${editorFamilies.length} 件 / プレビュー ${previewFamilies.length} 件（この Mac に入っているフォント）`;
    syncControls();
  };

  const openSettings = () => {
    lastFocused = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    dialog.focus();
    void ensureFonts();
  };

  const closeSettings = () => {
    overlay.hidden = true;
    fontLoadToken += 1;
    editorFontSelect.replaceChildren();
    previewFontSelect.replaceChildren();
    editorFamilies = [];
    previewFamilies = [];
    fontsLoaded = false;
    fontsStatus.hidden = true;
    fontsStatus.textContent = "";
    lastFocused?.focus();
    lastFocused = null;
  };

  // 起動時: フォールバックで即適用し、バックグラウンドでシステムフォント一覧を取得
  previewFamilies = [SYSTEM_UI_FAMILY, ...FALLBACK_FONT_FAMILIES];
  editorFamilies = FALLBACK_FONT_FAMILIES.filter((f) => f !== SYSTEM_UI_FAMILY);
  current = loadDisplaySettings(editorFamilies, previewFamilies);
  applyDisplaySettings(current);

  btnOpen.addEventListener("click", openSettings);
  btnClose.addEventListener("click", closeSettings);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSettings();
  });

  dialog.addEventListener("click", (e) => e.stopPropagation());

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) {
      e.preventDefault();
      closeSettings();
    }
  });

  editorFontFilter.addEventListener("input", syncControls);
  previewFontFilter.addEventListener("input", syncControls);

  editorFontSelect.addEventListener("change", () => {
    if (editorFontSelect.value) {
      commit({ editorFontFamily: editorFontSelect.value });
    }
  });
  previewFontSelect.addEventListener("change", () => {
    if (previewFontSelect.value) {
      commit({ previewFontFamily: previewFontSelect.value });
    }
  });
  editorSizeInput.addEventListener("input", () => {
    commit({ editorFontSize: Number(editorSizeInput.value) });
  });
  previewSizeInput.addEventListener("input", () => {
    commit({ previewFontSize: Number(previewSizeInput.value) });
  });

  editorLightCheckbox.addEventListener("change", () => {
    commit({ editorLightMode: editorLightCheckbox.checked });
  });
  fileWatchCheckbox.addEventListener("change", () => {
    commit({ fileWatchEnabled: fileWatchCheckbox.checked });
  });

  btnReset.addEventListener("click", () => {
    current = normalize(
      { ...DEFAULT_DISPLAY_SETTINGS },
      editorFamilies,
      previewFamilies,
    );
    applyDisplaySettings(current);
    saveDisplaySettings(current);
    editorFontFilter.value = "";
    previewFontFilter.value = "";
    syncControls();
    notifyFileWatchChange();
  });
}

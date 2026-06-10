import { getEditorMode, onEditorModeChange } from "../../../app/editor-mode";

const STORAGE_KEY = "karasu-sidebar-visible";

let visible = localStorage.getItem(STORAGE_KEY) === "true";
let sidebarAllowed = true;
let workspace: HTMLElement;
let btn: HTMLButtonElement;

function apply() {
  const show = sidebarAllowed && visible;
  workspace.classList.toggle("sidebar-hidden", !show);
  btn.hidden = !sidebarAllowed;
  btn.setAttribute("aria-expanded", String(show));
  btn.textContent = show ? "一覧を閉じる" : "一覧";
  btn.setAttribute(
    "aria-label",
    show ? "ファイル一覧を閉じる" : "ファイル一覧を開く",
  );
}

export function toggleSidebar(): void {
  if (!sidebarAllowed) return;
  visible = !visible;
  localStorage.setItem(STORAGE_KEY, String(visible));
  apply();
}

export function initSidebarLayout(): void {
  workspace = document.querySelector("#workspace") as HTMLElement;
  btn = document.querySelector("#btn-toggle-sidebar") as HTMLButtonElement;
  visible = localStorage.getItem(STORAGE_KEY) === "true";
  sidebarAllowed = getEditorMode() === "markdown";
  apply();
  btn.addEventListener("click", toggleSidebar);
  onEditorModeChange((mode) => {
    sidebarAllowed = mode === "markdown";
    apply();
  });
}

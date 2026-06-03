const STORAGE_KEY = "karasu-sidebar-visible";

let visible = localStorage.getItem(STORAGE_KEY) === "true";
let workspace: HTMLElement;
let btn: HTMLButtonElement;

function apply() {
  workspace.classList.toggle("sidebar-hidden", !visible);
  btn.setAttribute("aria-expanded", String(visible));
  btn.textContent = visible ? "一覧を閉じる" : "一覧";
  btn.setAttribute(
    "aria-label",
    visible ? "ファイル一覧を閉じる" : "ファイル一覧を開く",
  );
}

export function toggleSidebar(): void {
  visible = !visible;
  localStorage.setItem(STORAGE_KEY, String(visible));
  apply();
}

export function initSidebarLayout(): void {
  workspace = document.querySelector("#workspace") as HTMLElement;
  btn = document.querySelector("#btn-toggle-sidebar") as HTMLButtonElement;
  visible = localStorage.getItem(STORAGE_KEY) === "true";
  apply();
  btn.addEventListener("click", toggleSidebar);
}

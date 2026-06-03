const STORAGE_KEY = "karasu-sidebar-visible";

export function initSidebarLayout(): void {
  const workspace = document.querySelector("#workspace") as HTMLElement;
  const btn = document.querySelector("#btn-toggle-sidebar") as HTMLButtonElement;

  let visible = localStorage.getItem(STORAGE_KEY) === "true";

  const apply = () => {
    workspace.classList.toggle("sidebar-hidden", !visible);
    btn.setAttribute("aria-expanded", String(visible));
    btn.textContent = visible ? "一覧を閉じる" : "一覧";
    btn.setAttribute(
      "aria-label",
      visible ? "ファイル一覧を閉じる" : "ファイル一覧を開く",
    );
  };

  apply();

  btn.addEventListener("click", () => {
    visible = !visible;
    localStorage.setItem(STORAGE_KEY, String(visible));
    apply();
  });
}

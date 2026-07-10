// ATHLETE BRIDGE — 共通スクリプト
document.addEventListener("DOMContentLoaded", () => {
  // モバイルメニュー（今後ハンバーガーメニューを実装する場合の土台）
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      nav.classList.toggle("open");
    });
  }

  // 検索フォーム（現在はダミー。バックエンド接続後に実装）
  const searchForm = document.querySelector("#company-search");
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      alert("検索機能は準備中です。企業データベースと接続後に有効になります。");
    });
  }

  // 一覧ページのタグ絞り込み（見た目のみのダミー動作）
  const chips = document.querySelectorAll(".filter-chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
    });
  });
});

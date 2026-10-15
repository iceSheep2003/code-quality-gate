const task = document.querySelector("#task-filter");
const phase = document.querySelector("#phase-filter");
const outcome = document.querySelector("#outcome-filter");
const search = document.querySelector("#search");
function matches(row, query) {
  const selectors = [
    ["task", task.value],
    ["phase", phase.value],
    ["outcome", outcome.value],
  ];
  return (
    selectors.every(([key, value]) => !value || row.dataset[key] === value) &&
    (!query || row.dataset.search.includes(query))
  );
}
function filterRows() {
  const query = search.value.trim().toLowerCase();
  for (const row of document.querySelectorAll("[data-filter-record]")) {
    row.hidden = !matches(row, query);
  }
  for (const chart of document.querySelectorAll("[data-chart-task]"))
    chart.hidden = Boolean(
      task.value && chart.dataset.chartTask !== task.value,
    );
  const visible = document.querySelectorAll(
    "#iterations tbody tr:not([hidden])",
  ).length;
  document.querySelector("#visible-count").textContent = String(visible);
  document.querySelector("#no-matches").hidden = visible > 0;
}
for (const field of [task, phase, outcome, search])
  field.addEventListener("input", filterRows);
document.querySelector("#reset").addEventListener("click", () => {
  for (const field of [task, phase, outcome, search]) field.value = "";
  filterRows();
});
document.querySelector("#language").addEventListener("click", () => {
  const chinese = document.documentElement.lang === "en";
  document.documentElement.lang = chinese ? "zh-CN" : "en";
  search.placeholder = chinese ? "任务、文件、修改说明" : "Task, file, note";
  search.setAttribute(
    "aria-label",
    chinese
      ? "搜索任务、文件名或修改说明"
      : "Search task, filename or change note",
  );
});
document
  .querySelector("#print")
  .addEventListener("click", () => window.print());
filterRows();

function updateNavigation() {
  const target = window.location.hash || "#trends";
  for (const link of document.querySelectorAll("nav a")) {
    if (link.getAttribute("href") === target)
      link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", updateNavigation);
updateNavigation();

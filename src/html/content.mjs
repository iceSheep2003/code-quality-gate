import {
  escape,
  text,
  badge,
  decision,
  fields,
  findMetric,
  metricCell,
  rowData,
} from "./model.mjs";
function table(headers, rows, id) {
  return `<p class="table-hint">${text("Scroll horizontally for all columns", "横向滚动查看完整列")}</p><div class="table-scroll" tabindex="0" role="region" aria-label="${id}"><table id="${id}"><thead><tr>${headers.map(([en, zh]) => `<th scope="col">${text(en, zh)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function source(entry) {
  const value = entry.source;
  const fingerprint = value.fingerprint || "not declared";
  const files = value.baseline
    ? "baseline"
    : value.changedFiles?.join(", ") || "none";
  return `<code title="${escape(fingerprint)}">${escape(fingerprint.slice(0, 12))}</code><small>${escape(files)}</small>`;
}
function execution(entry) {
  const plan = entry.audit?.execution;
  if (!plan) return "—";
  return `${escape(plan.mode)}<small>${text("Executed", "已执行")}: ${escape(plan.selectedChecks.join(", "))}</small><small>${text("Deferred", "延期")}: ${escape(plan.deferredChecks.join(", ") || "—")}</small>`;
}
export function iterations(entries) {
  const rows = [...entries]
    .reverse()
    .map(
      (entry) =>
        `<tr ${rowData(entry)} data-sequence="${entry.sequence}"><td class="mono">#${entry.sequence}</td><td><strong>${escape(entry.task.id)}</strong><small>${escape(entry.timestamp)}</small></td><td>${escape(entry.phase.toUpperCase())}</td><td>${badge(entry.accepted ? "accepted" : "failed")}<small>${escape(decision(entry))}</small></td><td>${execution(entry)}</td><td>${source(entry)}</td><td>${escape(entry.note || entry.message)}</td></tr>`,
    )
    .join("");
  return table(
    [
      ["Run", "轮次"],
      ["Task / UTC", "任务 / UTC 时间"],
      ["Phase", "阶段"],
      ["Decision", "判定"],
      ["Test plan", "测试方案"],
      ["Code / changed files", "代码 / 修改文件"],
      ["Change note", "修改说明"],
    ],
    rows,
    "iterations",
  );
}
export function metrics(entries) {
  const columns = fields(entries);
  if (!columns.length)
    return `<p class="empty">${text("No numeric metrics are configured.", "尚未配置数值指标。")}</p>`;
  const headers = [
    ["Run", "轮次"],
    ...columns.map((field) => [
      field.label || field.path,
      field.label || field.path,
    ]),
  ];
  const rows = entries
    .map(
      (entry) =>
        `<tr ${rowData(entry)}><td class="mono">#${entry.sequence}<small>${escape(entry.task.id)}</small></td>${columns.map((field) => `<td>${metricCell(findMetric(entry, field))}</td>`).join("")}</tr>`,
    )
    .join("");
  return table(headers, rows, "metric-history");
}
export function checks(entries) {
  const rows = entries
    .flatMap((entry) =>
      entry.checks.map(
        (check) =>
          `<tr ${rowData(entry)}><td class="mono">#${entry.sequence}</td><td><strong>${escape(check.title || check.id)}</strong><small>${escape(check.id)}</small></td><td>${badge(check.status)}</td><td>${check.required ? text("Required", "必需") : text("Optional", "可选")}</td><td class="mono">${check.exitCode ?? "—"}</td><td class="mono">${check.durationMs ?? "—"}</td><td>${escape(check.details)}</td></tr>`,
      ),
    )
    .join("");
  return table(
    [
      ["Run", "轮次"],
      ["Check", "检查"],
      ["Result", "结果"],
      ["Policy", "规则"],
      ["Exit", "退出码"],
      ["ms", "毫秒"],
      ["Reason", "原因"],
    ],
    rows,
    "check-history",
  );
}
export function checkDetails(audit) {
  return (audit.checks || [])
    .map((check) => {
      const messages = (
        check.violations || (check.details ? [{ message: check.details }] : [])
      )
        .map(
          (violation) =>
            `<li>${escape(violation.message)}${violation.output ? `<pre>${escape(violation.output)}</pre>` : ""}</li>`,
        )
        .join("");
      return `<details class="check-detail" ${check.status !== "passed" ? "open" : ""}><summary>${badge(check.status)} ${escape(check.title || check.id)}<span class="detail-meta">${check.required === false ? text("Optional", "可选") : text("Required", "必需")} · ${check.durationMs ?? "—"} ms</span></summary>${messages ? `<ul>${messages}</ul>` : `<p>${text("No violations reported.", "未报告违规。")}</p>`}</details>`;
    })
    .join("");
}
export function filterBar(entries) {
  const tasks = [...new Set(entries.map((entry) => entry.task.id))];
  return `<div class="filters">
    <label>${text("Task", "任务")}<select id="task-filter"><option value="">${textOption("All tasks", "全部任务")}</option>${tasks.map((id) => `<option value="${escape(id)}">${escape(id)}</option>`).join("")}</select></label>
    <label>${text("Phase", "阶段")}<select id="phase-filter"><option value="">${textOption("All phases", "全部阶段")}</option>${["red", "green", "gate", "audit"].map((p) => `<option>${p}</option>`).join("")}</select></label>
    <label>${text("Decision", "判定")}<select id="outcome-filter"><option value="">${textOption("All decisions", "全部判定")}</option><option value="failed">${textOption("Failed", "未通过")}</option><option value="accepted">${textOption("Accepted", "已接受")}</option></select></label>
    <label class="search">${text("Find a change", "查找修改")}<input id="search" type="search" autocomplete="off" placeholder="Task, file, note" aria-label="Search task, filename or change note"></label>
    <button id="reset" type="button">${text("Reset", "重置")}</button></div>`;
}
function textOption(en, zh) {
  return `${escape(en)} / ${escape(zh)}`;
}

export function runRecords(entries) {
  return [...entries]
    .reverse()
    .map(
      (entry) =>
        `<details class="run-record check-detail" ${rowData(entry)}><summary><span class="mono">#${entry.sequence}</span> ${escape(entry.task.id)} · ${escape(entry.phase)} · ${escape(decision(entry))}</summary>${checkDetails({ checks: entry.checks })}<details class="raw-record"><summary>${text("All recorded data (JSON)", "全部记录数据（JSON）")}</summary><pre>${escape(JSON.stringify(entry, null, 2))}</pre></details></details>`,
    )
    .join("");
}

export function staticDetails(result) {
  if (!result.reports) return "";
  return result.reports
    .map((report) => {
      const rows = report.functions
        .map(
          (fn) =>
            `<tr><td>${escape(fn.name)}<small>${text("Line", "行")} ${fn.line}</small></td>${["cyclomatic", "cognitive", "depth", "parameters", "statements", "lines"].map((key) => `<td class="mono">${escape(fn.metrics[key] ?? "—")}</td>`).join("")}</tr>`,
        )
        .join("");
      const headers = [
        ["Function / line", "函数 / 行"],
        ["Cyclomatic", "圈复杂度"],
        ["Cognitive", "认知复杂度"],
        ["Depth", "嵌套深度"],
        ["Parameters", "参数数"],
        ["Statements", "语句数"],
        ["Lines", "行数"],
      ];
      return `<details class="check-detail" open><summary>${escape(report.filename)} <span class="detail-meta">${report.functions.length} ${text("functions", "个函数")}</span></summary>${table(headers, rows, `static-${escape(report.filename)}`)}</details>`;
    })
    .join("");
}

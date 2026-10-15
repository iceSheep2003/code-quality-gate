import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tool } from "../version.mjs";
import { measuredMetrics } from "../audit/history-metrics.mjs";
import { escape, text, badge, decision, normalizeAudit } from "./model.mjs";
import { charts } from "./charts.mjs";
import {
  iterations,
  metrics,
  checks,
  checkDetails,
  filterBar,
  staticDetails,
  runRecords,
} from "./content.mjs";
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const script = readFileSync(new URL("./client.js", import.meta.url), "utf8");
const digest = (value) => createHash("sha256").update(value).digest("base64");
function resultTask(result) {
  const fallback = result.reports
    ? { id: "static", title: "JS/TS static analysis" }
    : { id: "diagnostics", title: "Independent audit" };
  return result.id ? { id: result.id, title: result.id } : fallback;
}
function entryFromResult(result) {
  const audit = normalizeAudit(result);
  return {
    sequence: result.history?.sequence || 1,
    timestamp: audit.startedAt || "",
    task: resultTask(result),
    phase: result.phase || "audit",
    accepted: result.passed === true,
    auditPassed: audit.passed === true,
    canMerge: result.canMerge === true,
    message: result.message || "",
    note: "",
    source: { changedFiles: [], fingerprint: null },
    metrics: measuredMetrics(audit).metrics,
    displayMetrics: [],
    checks: (audit.checks || []).map((check) => ({
      ...check,
      required: check.required !== false,
      details: (check.violations || []).map((v) => v.message).join("; "),
    })),
  };
}
function headline(latest) {
  if (!latest) return text("No observations yet", "尚无检测记录");
  return escape(decision(latest));
}
function overview(latest, entries) {
  if (!latest) return `<h1>${headline(latest)}</h1>`;
  const status = latest.accepted ? "is-passed" : "is-failed";
  const passed = latest.checks.filter(
    (check) => check.status === "passed",
  ).length;
  return `<div class="overview"><div><p class="eyebrow">${text("Quality observation", "代码质量记录")} / #${latest.sequence}</p><h1>${escape(latest.task.title)}</h1><div class="identity mono">${escape(latest.task.id)} · ${escape(latest.timestamp)} · UTC</div><p class="intro">${escape(latest.note || latest.message)}</p>${workflow(latest)}</div>
    <aside class="decision-panel ${status}"><p class="eyebrow">${text("Workflow decision", "工作流判定")}</p><div class="decision-heading">${headline(latest)}</div><div class="decision-grid"><div><small>${text("Underlying audit", "实际检测结果")}</small><span class="value ${latest.auditPassed ? "pass-text" : "fail-text"}">${latest.auditPassed ? "PASS" : "FAIL"}</span></div><div><small>${text("Merge readiness", "合并就绪")}</small><span class="value">${latest.canMerge ? "READY" : "NOT READY"}</span></div><div><small>${text("Checks passed / executed", "通过 / 执行检查数")}</small><span class="value mono">${passed} / ${latest.checks.length}</span></div><div><small>${text("Recorded observations", "已记录轮次")}</small><span class="value mono">${entries.length}</span></div></div></aside></div>`;
}
function workflow(latest) {
  const labels = [
    ["red", "Failing tests", "失败测试"],
    ["green", "Implementation", "实现检查"],
    ["gate", "Final audit", "最终门禁"],
  ];
  return `<div class="workflow">${labels.map(([phase, en, zh]) => `<div class="step"><b>${phase.toUpperCase()}</b><i>${text(en, zh)}</i>${latest.phase === phase ? badge(latest.accepted ? "passed" : "failed") : ""}</div>`).join("")}</div>`;
}
function section(id, en, zh, content) {
  return `<section class="section" id="${id}"><div class="section-heading"><h2>${text(en, zh)}</h2></div>${content}</section>`;
}
function navigation() {
  return `<nav aria-label="Report sections">${[
    ["trends", "Metric trends", "指标趋势"],
    ["runs", "Iterations", "迭代记录"],
    ["metrics", "Measurements", "指标明细"],
    ["checks", "Check execution", "检查执行"],
    ["records", "Full records", "完整记录"],
  ]
    .map(([id, en, zh]) => `<a href="#${id}">${text(en, zh)}</a>`)
    .join("")}</nav>`;
}
function body(entries, result) {
  const latest = entries.at(-1);
  const legend = `<div class="legend"><span><i class="line"></i>${text("Measured value", "实际值")}</span><span><i class="line bound"></i>${text("Bounds for that iteration", "该轮门槛")}</span></div>`;
  const trendNote = text(
    "Charts group by task. Missing/error/not-run observations break the line; bounds belong to each iteration. Phase, decision and search filters apply to tables; task also filters charts.",
    "图表按任务分组；缺失、错误和未运行会断开曲线，门槛按当轮展示。阶段、判定与搜索用于筛选表格；任务筛选同时作用于图表。",
  );
  const count = `<p class="filter-count" aria-live="polite"><span id="visible-count">${entries.length}</span> ${text("visible iterations", "条可见迭代")}</p>`;
  const details = result
    ? section(
        "details",
        "This run: check details",
        "本轮检查详情",
        checkDetails(normalizeAudit(result)) + staticDetails(result),
      )
    : "";
  return `${overview(latest, entries)}${navigation()}${filterBar(entries)}${count}${section("trends", "Metric trends", "指标趋势", `<p class="caption">${trendNote}</p>${legend}<div class="chart-grid">${charts(entries)}</div>`)}${details}${section("runs", "Iteration record", "迭代记录", iterations(entries))}${section("metrics", "Measured metrics & bounds", "指标实测值与门槛", metrics(entries))}${section("checks", "Check execution", "检查执行", checks(entries))}${section("records", "Complete run records & diagnostics", "全部检测记录与诊断", runRecords(entries))}`;
}
export function reportHtml({ entries, result } = {}) {
  const observations = entries || (result ? [entryFromResult(result)] : []);
  const csp = `default-src 'none'; script-src 'sha256-${digest(script)}'; style-src 'sha256-${digest(css)}'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><title>Code Quality Gate · ${escape(observations.at(-1)?.task.id || "Report")}</title><style>${css}</style></head>
<body><header><div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 5H5v22h4M23 5h4v22h-4" fill="none" stroke="#d3e4f2" stroke-width="2"/><path d="m11 16 4 5 8-11" fill="none" stroke="#75d9b4" stroke-width="2.5"/></svg>Code Quality Gate<span class="edition">v${escape(tool.version)} / HTML report</span></div><div class="header-actions"><button id="language" type="button">中文 / EN</button><button id="print" type="button">${text("Print / PDF", "打印 / PDF")}</button></div></header><main><noscript><p class="noscript">All results are readable without JavaScript. Enable it for filters, language switching and printing controls.</p></noscript>${body(observations, result)}<footer><p>${text("Generated from executed checks and the recorded observation ledger. Notes describe intent; tools supply the numbers. A successful red phase can contain a failing audit. Only a fresh accepted gate grants merge readiness.", "报告来自实际检测与历史记录。说明描述修改意图，数值来自工具。red 被接受时底层测试仍可失败；只有最新门禁通过才代表可合并。")}</p><p>${text("This file works offline. Metrics are not a proof that every requirement is tested. Reopen the generated file to see a later run; this page does not auto-refresh.", "此文件支持离线查看。指标不能证明所有需求都已测试。后续运行后需重新打开生成的文件，页面不会自动刷新。")}</p></footer></main><script>${script}</script></body></html>\n`;
}

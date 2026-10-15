import {
  escape,
  text,
  fields,
  findMetric,
  number,
  policy,
  metricCell,
} from "./model.mjs";
function measured(metric) {
  return (
    metric &&
    Number.isFinite(metric.actual) &&
    !["error", "missing", "not-run"].includes(metric.status)
  );
}
function scale(entries, field) {
  const values = entries.flatMap((entry) => {
    const metric = findMetric(entry, field);
    if (!metric) return [];
    return [
      measured(metric) ? metric.actual : null,
      metric.min,
      metric.max,
      metric.equals,
    ].filter(Number.isFinite);
  });
  const min = Math.min(...values),
    max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.03, 1);
  return { min: min >= 0 ? Math.max(0, min - pad) : min - pad, max: max + pad };
}
function plot(entries, field) {
  if (!entries.some((entry) => measured(findMetric(entry, field))))
    return `<p class="empty">${text("No measurements yet", "尚无测量值")}</p>`;
  const range = scale(entries, field);
  if (!Number.isFinite(range.min))
    return `<p class="empty">${text("No measurements yet", "尚无测量值")}</p>`;
  const points = entries.map((entry, index) => {
    const metric = findMetric(entry, field);
    const x = 90 + (index / Math.max(1, entries.length - 1)) * 474;
    const y = measured(metric)
      ? 86 - ((metric.actual - range.min) / (range.max - range.min)) * 64
      : null;
    return { entry, metric, x, y };
  });
  return svg(points, range, field);
}
function line(points) {
  let path = "",
    connected = false;
  for (const point of points) {
    if (point.y === null) {
      connected = false;
      continue;
    }
    path += `${connected ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)} `;
    connected = true;
  }
  return `<path class="trend-line" d="${path.trim()}"/>`;
}
function dots(points) {
  return points
    .filter((point) => point.y !== null)
    .map(
      ({ entry, metric, x, y }) =>
        `<circle class="point ${metric.status === "failed" ? "failed" : "passed"}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4"><title>${escape(`#${entry.sequence}: ${number(metric.actual)} ${policy(metric)} · ${metric.status}`)}</title></circle>`,
    )
    .join("");
}
function thresholds(points, range) {
  return points
    .flatMap(({ metric, x }) => {
      if (!metric) return [];
      return ["min", "max", "equals"]
        .filter((key) => Number.isFinite(metric[key]))
        .map((key) => {
          const y =
            86 - ((metric[key] - range.min) / (range.max - range.min)) * 64;
          return `<path class="threshold" d="M${(x - 9).toFixed(2)},${y.toFixed(2)}h18"><title>${escape(`${key}: ${metric[key]}`)}</title></path>`;
        });
    })
    .join("");
}
function svg(points, range, field) {
  return `<svg viewBox="0 0 600 120" role="img" aria-label="${escape((field.label || field.path) + ": measured values and per-iteration bounds")}">
    <title>${escape(field.label || field.path)}</title>
    <path class="grid" d="M90 22H574M90 54H574M90 86H574"/>
    <text x="4" y="26">${escape(number(range.max))}</text><text x="4" y="90">${escape(number(range.min))}</text>
    ${thresholds(points, range)}${line(points)}${dots(points)}
    <text x="90" y="112">#${points[0].entry.sequence}</text><text x="540" y="112">#${points.at(-1).entry.sequence}</text>
  </svg>`;
}
export function charts(entries) {
  const groups = [...new Set(entries.map((entry) => entry.task.id))];
  const cards = groups.flatMap((task) => {
    const subset = entries.filter((entry) => entry.task.id === task);
    return fields(entries)
      .filter((field) => subset.some((entry) => findMetric(entry, field)))
      .map(
        (field) =>
          `<article class="chart" data-chart-task="${escape(task)}"><div class="chart-heading"><h3>${escape(field.label || field.path)}</h3><span class="mono">${escape(task)} · ${escape(field.check)}</span></div>${plot(subset, field)}<div class="chart-reading">${metricCell(findMetric(subset.at(-1), field))}</div></article>`,
      );
  });
  return cards.length
    ? cards.join("")
    : `<p class="empty">${text("No numeric metrics are configured. Execution results are recorded below.", "尚未配置数值指标，执行结果见下表。")}</p>`;
}

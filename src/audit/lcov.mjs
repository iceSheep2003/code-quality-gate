const fields = {
  LF: "linesFound",
  LH: "linesHit",
  BRF: "branchesFound",
  BRH: "branchesHit",
  FNF: "functionsFound",
  FNH: "functionsHit",
};
function recordMetrics(record) {
  const metrics = {};
  for (const name of ["lines", "branches", "functions"]) {
    if (
      Object.hasOwn(record, name + "Found") !==
      Object.hasOwn(record, name + "Hit")
    )
      throw new Error(`Incomplete LCOV ${name} counts`);
    const found = record[name + "Found"] ?? 0;
    const hit = record[name + "Hit"] ?? 0;
    if (hit > found) throw new Error(`Invalid LCOV ${name}: hits exceed total`);
    metrics[name + "Found"] = found;
    metrics[name + "Hit"] = hit;
  }
  return metrics;
}
function parseRecords(raw) {
  const records = [];
  let record = {};
  for (const line of raw.split(/\r?\n/)) {
    if (line === "end_of_record") {
      records.push(recordMetrics(record));
      record = {};
      continue;
    }
    const colon = line.indexOf(":");
    const key = fields[line.slice(0, colon)];
    if (!key) continue;
    const value = Number(line.slice(colon + 1));
    if (!Number.isSafeInteger(value) || value < 0 || Object.hasOwn(record, key))
      throw new Error("Invalid or repeated LCOV coverage count");
    record[key] = value;
  }
  if (Object.keys(record).length) throw new Error("Incomplete LCOV report");
  return records;
}
export function parseLcov(raw) {
  const metrics = {};
  for (const record of parseRecords(raw))
    for (const [key, value] of Object.entries(record))
      metrics[key] = (metrics[key] || 0) + value;
  if (!metrics.linesFound && !metrics.branchesFound && !metrics.functionsFound)
    throw new Error("LCOV report has no coverage records");
  for (const name of ["lines", "branches", "functions"])
    if (metrics[name + "Found"])
      metrics[name] = (metrics[name + "Hit"] / metrics[name + "Found"]) * 100;
  return metrics;
}

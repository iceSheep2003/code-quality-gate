import { posix } from "node:path";
import { hash } from "./ast.mjs";
import { extensions } from "./files.mjs";
function resolveImport(from, specifier, files) {
  if (!specifier.startsWith(".")) return null;
  const path = posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = [
    path,
    ...extensions.map((ext) => path + "." + ext),
    ...extensions.map((ext) => path + "/index." + ext),
  ];
  if (/\.(js|mjs|cjs)$/.test(path))
    candidates.push(
      path.replace(/\.js$/, ".ts"),
      path.replace(/\.js$/, ".tsx"),
      path.replace(/\.mjs$/, ".mts"),
      path.replace(/\.cjs$/, ".cts"),
    );
  return candidates.find((p) => files.has(p)) ?? null;
}
function components(graph) {
  let clock = 0;
  const stack = [],
    active = new Set(),
    indices = new Map(),
    low = new Map(),
    found = [];
  function visit(node) {
    indices.set(node, clock);
    low.set(node, clock++);
    stack.push(node);
    active.add(node);
    for (const edge of graph.get(node)) {
      if (!indices.has(edge.to)) {
        visit(edge.to);
        low.set(node, Math.min(low.get(node), low.get(edge.to)));
      } else if (active.has(edge.to))
        low.set(node, Math.min(low.get(node), indices.get(edge.to)));
    }
    if (low.get(node) !== indices.get(node)) return;
    const group = [];
    let member;
    do {
      member = stack.pop();
      active.delete(member);
      group.push(member);
    } while (member !== node);
    if (group.length > 1 || graph.get(node).some((e) => e.to === node))
      found.push(group.sort());
  }
  for (const node of graph.keys()) if (!indices.has(node)) visit(node);
  return found;
}
export function dependencyCycles(reports) {
  const files = new Set(reports.map((r) => r.filename)),
    graph = new Map();
  for (const report of reports)
    graph.set(
      report.filename,
      (report.dependencies || [])
        .map((d) => ({
          ...d,
          to: resolveImport(report.filename, d.specifier, files),
        }))
        .filter((d) => d.to),
    );
  return components(graph).map((group) => {
    const members = new Set(group),
      edges = group.flatMap((from) =>
        graph
          .get(from)
          .filter((d) => members.has(d.to))
          .map((d) => ({ from, to: d.to, line: d.line, column: d.column })),
      ),
      first = edges[0];
    return {
      filename: first.from,
      line: first.line,
      column: first.column,
      function: "<module>",
      rule: "dependency-cycle",
      message: "Circular dependency component: " + group.join(", "),
      fingerprint: hash(edges.map(({ from, to }) => ({ from, to }))),
      members: group,
      edges,
    };
  });
}

import { createHash } from "node:crypto";
const ignored = new Set([
  "parent",
  "loc",
  "range",
  "start",
  "end",
  "raw",
  "tokens",
  "comments",
]);
export const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object")
    return typeof value === "bigint" ? String(value) : value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((k) => !ignored.has(k))
      .sort()
      .map((k) => [k, canonical(value[k])]),
  );
}
export const isFunction = (node) =>
  [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ].includes(node.type);
export function children(node) {
  return Object.entries(node)
    .filter(([key]) => !ignored.has(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter(
      (value) =>
        value && typeof value === "object" && typeof value.type === "string",
    );
}
export function visit(node, callback) {
  callback(node);
  for (const child of children(node)) visit(child, callback);
}
export function functionName(node) {
  if (node.id?.name) return node.id.name;
  if (node.parent?.type === "VariableDeclarator")
    return node.parent.id.name || "<destructured>";
  return node.parent?.key?.name || "<callback>";
}
export function statementCount(node) {
  let count = 0;
  const walk = (current) => {
    if (current !== node && isFunction(current)) return;
    if (
      (current.type.endsWith("Statement") &&
        current.type !== "BlockStatement") ||
      current.type === "VariableDeclaration"
    )
      count++;
    for (const child of children(current)) walk(child);
  };
  walk(node);
  return count;
}
export function activeLines(source, node) {
  const comments = source
    .getAllComments()
    .filter((c) => c.range[0] >= node.range[0] && c.range[1] <= node.range[1]);
  let text = source.text.slice(...node.range);
  for (const c of comments.reverse()) {
    const start = c.range[0] - node.range[0],
      end = c.range[1] - node.range[0];
    text =
      text.slice(0, start) +
      text.slice(start, end).replace(/[^\n]/g, " ") +
      text.slice(end);
  }
  return text.split("\n").filter((line) => line.trim()).length;
}
export function halstead(tokens) {
  const operators = [],
    operands = [];
  for (const t of tokens)
    ([
      "Identifier",
      "Numeric",
      "String",
      "RegularExpression",
      "Template",
      "Boolean",
      "Null",
    ].includes(t.type)
      ? operands
      : operators
    ).push(t.value);
  const length = operators.length + operands.length,
    vocabulary = new Set(operators).size + new Set(operands).size;
  return {
    length,
    vocabulary,
    volume: length * Math.log2(Math.max(1, vocabulary)),
  };
}
export function maintainability(volume, complexity, lines) {
  return Math.round(
    Math.min(
      100,
      Math.max(
        0,
        ((171 -
          5.2 * Math.log(Math.max(1, volume)) -
          0.23 * complexity -
          16.2 * Math.log(Math.max(1, lines))) *
          100) /
          171,
      ),
    ),
  );
}

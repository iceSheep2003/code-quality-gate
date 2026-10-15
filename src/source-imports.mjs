import { visit } from "./ast.mjs";
function typeOnly(node) {
  if (node.importKind === "type" || node.exportKind === "type") return true;
  return (
    node.specifiers?.length > 0 &&
    node.specifiers.every(
      (s) => s.importKind === "type" || s.exportKind === "type",
    )
  );
}
function staticSpecifier(node) {
  if (
    ![
      "ImportDeclaration",
      "ExportNamedDeclaration",
      "ExportAllDeclaration",
    ].includes(node.type)
  )
    return null;
  if (!node.source || typeOnly(node)) return null;
  return node.source.value;
}
function dynamicSpecifier(node) {
  if (node.type === "ImportExpression") return node.source?.value;
  if (
    node.type === "CallExpression" &&
    node.callee?.name === "require" &&
    node.arguments.length === 1
  )
    return node.arguments[0]?.value;
  return null;
}
export function sourceDependencies(ast) {
  const dependencies = [];
  visit(ast, (node) => {
    const specifier = staticSpecifier(node) ?? dynamicSpecifier(node);
    if (typeof specifier === "string")
      dependencies.push({
        specifier,
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
      });
  });
  return dependencies;
}

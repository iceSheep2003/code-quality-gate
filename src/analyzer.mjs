import { Linter } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";
import sonarjs from "eslint-plugin-sonarjs";
import * as tsParser from "@typescript-eslint/parser";
import { sourceDependencies } from "./source-imports.mjs";
import {
  canonical,
  hash,
  isFunction,
  visit,
  functionName,
  statementCount,
  activeLines,
  halstead,
  maintainability,
} from "./ast.mjs";
const safetyRules = [
  "no-eval",
  "no-implied-eval",
  "no-new-func",
  "no-async-promise-executor",
  "no-promise-executor-return",
  "no-unreachable",
  "no-unsafe-finally",
  "no-unsafe-optional-chaining",
  "no-constant-binary-expression",
];
const location = (node) => ({
  line: node.loc.start.line,
  column: node.loc.start.column + 1,
});
function contains(node, loc) {
  const { start, end } = node.loc;
  return (
    (start.line < loc.line ||
      (start.line === loc.line && start.column <= loc.column)) &&
    (end.line > loc.line || (end.line === loc.line && end.column >= loc.column))
  );
}
function ownerOf(functions, loc) {
  return functions
    .filter((f) => contains(f.node, loc))
    .sort(
      (a, b) =>
        a.node.range[1] - a.node.range[0] - (b.node.range[1] - b.node.range[0]),
    )[0];
}
function observedRule(rule, collector) {
  return {
    meta: rule.meta,
    create(context) {
      const observed = Object.create(context);
      Object.defineProperty(observed, "report", { value: collector });
      return rule.create(observed);
    },
  };
}
function functionRecord(node, source) {
  return {
    node,
    name: functionName(node),
    fingerprint: hash(canonical(node)),
    ...location(node),
    metrics: {
      cyclomatic: 1,
      cognitive: 0,
      depth: 0,
      parameters: node.params.length,
      statements: statementCount(node),
      lines: activeLines(source, node),
    },
  };
}
function collectorRule(state) {
  return {
    create(context) {
      return {
        Program(node) {
          state.node = node;
          state.source = context.sourceCode;
          visit(node, (n) => {
            if (isFunction(n))
              state.functions.push(functionRecord(n, context.sourceCode));
          });
        },
      };
    },
  };
}
function metricCollector(state, metric, field) {
  return (descriptor) => {
    const loc =
      descriptor.loc?.start || descriptor.loc || descriptor.node?.loc.start;
    const owner =
      descriptor.node && isFunction(descriptor.node)
        ? state.functions.find((f) => f.node === descriptor.node)
        : ownerOf(state.functions, loc);
    if (owner)
      owner.metrics[metric] = Math.max(
        owner.metrics[metric],
        Number(descriptor.data[field]),
      );
  };
}
function analysisConfig(state, filename) {
  const rules = {
    collect: collectorRule(state),
    cyclomatic: observedRule(
      builtinRules.get("complexity"),
      metricCollector(state, "cyclomatic", "complexity"),
    ),
    depth: observedRule(
      builtinRules.get("max-depth"),
      metricCollector(state, "depth", "depth"),
    ),
    cognitive: observedRule(
      sonarjs.rules["cognitive-complexity"],
      metricCollector(state, "cognitive", "complexityAmount"),
    ),
  };
  return {
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    linterOptions: { noInlineConfig: true },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: /\.(?:cjs|cts)$/.test(filename) ? "commonjs" : "module",
      ...(/\.(?:ts|mts|cts|tsx)$/.test(filename) ? { parser: tsParser } : {}),
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { quality: { rules } },
    rules: {
      "quality/collect": "error",
      "quality/cyclomatic": ["error", { max: 0, variant: "modified" }],
      "quality/depth": ["error", 0],
      "quality/cognitive": ["error", 0],
      ...Object.fromEntries(safetyRules.map((r) => [r, "error"])),
    },
  };
}
function lintFindings(messages, state) {
  return messages
    .filter((m) => !m.fatal && m.ruleId)
    .map((m) => {
      const owner = ownerOf(state.functions, {
        line: m.line,
        column: m.column - 1,
      });
      return {
        rule: m.ruleId,
        message: m.message,
        line: m.line,
        column: m.column,
        fingerprint: owner?.fingerprint || hash(canonical(state.node)),
        function: owner?.name || "<module>",
      };
    });
}
function fileMetrics(state) {
  const halsteadMetrics = halstead(state.source.ast.tokens),
    lines = activeLines(state.source, state.node),
    cyclomatic = state.functions.reduce((n, f) => n + f.metrics.cyclomatic, 0);
  return {
    lines,
    functions: state.functions.length,
    statements: statementCount(state.node),
    cyclomatic,
    halstead: halsteadMetrics,
    maintainability: maintainability(halsteadMetrics.volume, cyclomatic, lines),
  };
}
export function analyzeSource(code, { filename = "source.mjs" } = {}) {
  const state = { functions: [], node: null, source: null };
  const messages = new Linter().verify(code, analysisConfig(state, filename), {
    filename,
  });
  const parseErrors = messages
    .filter((m) => m.fatal)
    .map((m) => ({ message: m.message, line: m.line, column: m.column }));
  if (parseErrors.length)
    return {
      filename,
      functions: [],
      files: { fingerprint: hash(code), metrics: {} },
      findings: [],
      parseErrors,
    };
  if (!state.node) throw new Error("Unsupported source filename: " + filename);
  const dependencies = sourceDependencies(state.node);
  return {
    filename,
    dependencies,
    functions: state.functions.map(({ node, ...rest }) => rest),
    files: {
      fingerprint: hash(canonical(state.node)),
      metrics: fileMetrics(state),
    },
    findings: lintFindings(messages, state),
    parseErrors,
  };
}

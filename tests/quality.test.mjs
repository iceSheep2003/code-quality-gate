import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeSource,
  evaluateReport,
  createBaseline,
  defaults,
} from "../src/index.mjs";

const analyze = (source) =>
  analyzeSource(source, { filename: "server/example.mjs" });
test("default thresholds have concrete per-function and per-file limits", () => {
  assert.equal(defaults.limits.cyclomatic, 10);
  assert.equal(defaults.limits.cognitive, 15);
  assert.equal(defaults.limits.depth, 4);
  assert.equal(defaults.limits.parameters, 4);
});
test("function metrics use AST statements instead of trusting physical lines", () => {
  const r = analyze("export function choose(x){if(x){return 1;}return 0;}");
  assert.equal(r.functions[0].metrics.cyclomatic, 2);
  assert.equal(r.functions[0].metrics.cognitive, 1);
  assert.equal(r.functions[0].metrics.parameters, 1);
  assert.ok(r.functions[0].metrics.statements >= 3);
  assert.equal(r.parseErrors.length, 0);
});
test("high complexity fails and equivalent formatting produces the same fingerprint", () => {
  const s =
    "export function many(x){" +
    Array.from({ length: 11 }, (_, i) => `if(x===${i})return ${i};`).join("") +
    "return 99;}";
  const r = analyze(s),
    formatted = analyze(s.replaceAll(";", ";\n"));
  assert.ok(
    evaluateReport([r]).violations.some((v) => v.metric === "cyclomatic"),
  );
  assert.equal(r.functions[0].fingerprint, formatted.functions[0].fingerprint);
});
test("switch cases count once in modified cyclomatic complexity", () => {
  const r = analyze(
    "function choose(x){switch(x){case 1:return 1;case 2:return 2;default:return 0;}}",
  );
  assert.equal(r.functions[0].metrics.cyclomatic, 2);
});
test("nested functions are measured independently", () => {
  const r = analyze(
    "function outer(){return function inner(x){if(x)return 1;return 0;};}",
  );
  assert.equal(
    r.functions.find((f) => f.name === "outer").metrics.cyclomatic,
    1,
  );
  assert.equal(
    r.functions.find((f) => f.name === "inner").metrics.cyclomatic,
    2,
  );
});
test("over-deep nesting, excessive parameters and compressed long functions fail", () => {
  const r = analyze(
    "function deep(a,b,c,d,e){if(a){if(b){if(c){if(d){if(e){return 1;}}}}}}",
  );
  const violations = evaluateReport([r]).violations;
  assert.ok(violations.some((v) => v.metric === "depth"));
  assert.ok(violations.some((v) => v.metric === "parameters"));
  const long = analyze(
    "function long(){" +
      Array.from({ length: 41 }, (_, i) => `const a${i}=${i};`).join("") +
      "}",
  );
  assert.ok(
    evaluateReport([long]).violations.some((v) => v.metric === "statements"),
  );
});
test("unchanged legacy violations can be baselined, new or changed functions cannot", () => {
  const s =
    "function legacy(x){" +
    Array.from({ length: 11 }, (_, i) => `if(x===${i})return ${i};`).join("") +
    "return 99;}";
  const r = analyze(s),
    baseline = createBaseline([r]);
  assert.equal(evaluateReport([r], { baseline }).passed, true);
  assert.equal(
    evaluateReport([analyze(s.replace("return 99", "return 100"))], {
      baseline,
    }).passed,
    false,
  );
  assert.equal(
    evaluateReport([analyze(s + "\n" + s.replace("legacy", "newCode"))], {
      baseline,
    }).passed,
    false,
  );
});
test("syntax failures cannot be baselined or waived", () => {
  const r = analyze("function broken( {");
  assert.ok(r.parseErrors.length);
  assert.equal(
    evaluateReport([r], { baseline: createBaseline([r]) }).passed,
    false,
  );
});
test("unsafe JavaScript fails independently from complexity", () => {
  const r = analyze('function unsafe(){return eval("2+2");}');
  assert.ok(evaluateReport([r]).violations.some((v) => v.rule === "no-eval"));
});
test("coverage thresholds reject missing summaries and low branch coverage", () => {
  const r = analyze("export function sum(a,b){return a+b;}");
  assert.equal(
    evaluateReport([r], {
      coverage: { lines: 95, functions: 95, branches: 79 },
    }).passed,
    false,
  );
  assert.equal(
    evaluateReport([r], {
      coverage: { lines: 95, functions: 95, branches: 85 },
    }).passed,
    true,
  );
});
test("maintainability index is diagnostic and cannot override a hard failure", () => {
  const r = analyze("function simple(x){return x+1;}");
  assert.ok(
    r.files.metrics.maintainability >= 0 &&
      r.files.metrics.maintainability <= 100,
  );
  const s = analyze("function wide(a,b,c,d,e){return a;}");
  assert.equal(evaluateReport([s]).passed, false);
});
test("inline eslint disabling cannot suppress safety checks or metrics", () => {
  const r = analyze(
    '/* eslint-disable */ function unsafe(){return eval("2+2");}',
  );
  assert.ok(evaluateReport([r]).violations.some((v) => v.rule === "no-eval"));
  assert.equal(r.functions.length, 1);
});
test("same-line nested functions attach cognitive metrics to the correct owner", () => {
  const r = analyze(
    "function outer(){return function inner(x){if(x){if(x>1)return 1;}return 0;};}",
  );
  assert.equal(
    r.functions.find((f) => f.name === "outer").metrics.cognitive,
    0,
  );
  assert.equal(
    r.functions.find((f) => f.name === "inner").metrics.cognitive,
    3,
  );
});
test("adjacent functions, modern optional chains and default parameters are measured correctly", () => {
  const r = analyze(
    "function first(){return 0;} function second(a={}){if(a.x?.y)return 1;return 0;}",
  );
  assert.equal(r.functions[0].metrics.cognitive, 0);
  assert.equal(r.functions[1].metrics.cognitive, 1);
  assert.equal(r.functions[1].metrics.cyclomatic, 4);
});
test("stale policy baselines and invalid limits fail closed", () => {
  const r = analyze("function short(){return 1;}");
  assert.throws(() =>
    evaluateReport([r], { baseline: { version: 9, entries: [] } }),
  );
  assert.throws(() => evaluateReport([r], { limits: { cyclomatic: NaN } }));
  assert.throws(() => evaluateReport([r], { limits: { mystery: 10 } }));
  assert.equal(evaluateReport([]).passed, false);
  assert.equal(evaluateReport([r], { coverage: {} }).passed, false);
});
test("CommonJS files use their native parser mode", () => {
  const r = analyzeSource("if(module.parent){return;}module.exports=1;", {
    filename: "server/example.cjs",
  });
  assert.equal(r.parseErrors.length, 0);
});

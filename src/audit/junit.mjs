import { XMLParser, XMLValidator } from "fast-xml-parser";
const array = (value) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
function count(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error(`Invalid JUnit ${name} count`);
  return number;
}
function caseCounts(cases) {
  return cases.reduce(
    (total, item) => ({
      tests: total.tests + 1,
      failures:
        total.failures +
        Number(Object.hasOwn(item, "failure") || Object.hasOwn(item, "error")),
      skipped: total.skipped + Number(Object.hasOwn(item, "skipped")),
      errors: total.errors + Number(Object.hasOwn(item, "error")),
    }),
    { tests: 0, failures: 0, skipped: 0, errors: 0 },
  );
}
function addCounts(items) {
  return items.reduce(
    (total, item) => ({
      tests: total.tests + item.tests,
      failures: total.failures + item.failures,
      skipped: total.skipped + item.skipped,
      errors: total.errors + item.errors,
    }),
    { tests: 0, failures: 0, skipped: 0, errors: 0 },
  );
}
function attributes(suite) {
  return {
    tests: count(suite.tests ?? 0, "tests"),
    failures:
      count(suite.failures ?? 0, "failures") +
      count(suite.errors ?? 0, "errors"),
    skipped: count(suite.skipped ?? 0, "skipped"),
    errors: count(suite.errors ?? 0, "errors"),
  };
}
function suiteCounts(suite) {
  if (!suite || typeof suite !== "object")
    throw new Error("Invalid JUnit suite");
  const nested = array(suite.testsuite).map(suiteCounts);
  const cases = array(suite.testcase);
  const actual = addCounts([...nested, caseCounts(cases)]);
  const declared = attributes(suite);
  if (!nested.length && !cases.length) return declared;
  if (suite.tests !== undefined && actual.tests !== declared.tests)
    throw new Error("JUnit test counts disagree with test cases");
  actual.failures = Math.max(actual.failures, declared.failures);
  actual.skipped = Math.max(actual.skipped, declared.skipped);
  actual.errors = Math.max(actual.errors, declared.errors);
  return actual;
}
export function parseJunit(raw) {
  if (XMLValidator.validate(raw) !== true || /<!DOCTYPE|<!ENTITY/i.test(raw))
    throw new Error("Invalid JUnit XML report");
  const data = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    alwaysCreateTextNode: true,
  }).parse(raw);
  const suites = data.testsuites ? [data.testsuites] : array(data.testsuite);
  if (!suites.length) throw new Error("JUnit report has no test suites");
  const counts = addCounts(suites.map(suiteCounts));
  if (counts.failures + counts.skipped > counts.tests)
    throw new Error("Invalid JUnit result counts");
  const passed = counts.tests - counts.failures - counts.skipped;
  return {
    ...counts,
    assertionFailures: counts.failures - counts.errors,
    loadingErrors: loadingErrorCount(raw),
    passed,
    successRate: counts.tests ? (passed / counts.tests) * 100 : 0,
  };
}

function loadingErrorCount(raw) {
  const failures = [
    ...raw.matchAll(/<failure\b[^>]*>([\s\S]*?)<\/failure>/g),
  ].map((match) => match[1]);
  return failures.filter(
    (text) =>
      (text.includes("ERR_TEST_FAILURE") && !text.includes("ERR_ASSERTION")) ||
      /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ModuleNotFoundError|SyntaxError|ReferenceError/.test(
        text,
      ),
  ).length;
}

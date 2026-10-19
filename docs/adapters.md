# 接入自己的语言工具

本包负责执行和判定，语言分析仍使用项目自己的工具。每个 `command` 是 argv 数组；一个检查只读取自己本次生成的一个报告。不支持只导入以前的报告，也不自动发现某语言的工具。

| 场景 | 项目工具举例 | 建议接口 |
| --- | --- | --- |
| Java / Kotlin / Android | Gradle test、Android Lint、detekt、SpotBugs | JUnit 单个 suite 报告或汇总 JSON；发现违规应非零退出 |
| Python | unittest、pytest、Ruff、Pyright、coverage.py、mutmut | JUnit / LCOV / JSON / 命令退出码 |
| Go | go test、go vet、golangci-lint、go-mutesting | 退出码；Go coverage 原生格式需项目脚本转换为数值 JSON |
| Rust | cargo test、cargo clippy、cargo llvm-cov、cargo-mutants | 退出码 / LCOV / 汇总 JSON |
| C / C++ | CTest、clang-tidy、gcov/lcov、Mull | JUnit / LCOV / 汇总 JSON |
| JS / TS | tsc、ESLint、Vitest/Jest、Stryker、jscpd | 退出码 / JUnit / LCOV / 汇总 JSON；内置 check 另见 js-ts-checks.md |

这些是可接入的工具选择，不表示本包已经替用户安装、配置或实际运行了表中所有工具。

## 最简单的接口：退出码

```json
{
  "id": "go-tests",
  "title": "Go test suite",
  "command": ["go", "test", "./..."]
}
```

发现问题必须让命令非零退出。退出 0 只证明该命令认为自己成功，无法证明有多少测试或检查了多少文件。需要这类保证时，应当输出结构化报告并为数量配置下限。

## 通用 JSON：把真实工具结果归一化

项目提供一个脚本，由它执行真正的检测器，生成报告。例如命令 `['python3','quality_adapter.py']` 对应：

```json
{
  "metrics": {
    "tests": 80,
    "failures": 0,
    "lineCoverage": 86.4,
    "branchCoverage": 78.2,
    "mutationScore": 66.7,
    "validMutants": 150,
    "invalidMutants": 2,
    "incompleteMutants": 0,
    "duplicationPercentage": 1.5
  }
}
```

配置的 `report` 指向这个本次生成的 JSON，`metrics` 中写：

```json
[
  { "name": "验收测试", "path": "tests", "min": 1 },
  { "name": "失败数", "path": "failures", "equals": 0 },
  { "name": "分支覆盖率", "path": "branchCoverage", "min": 75 },
  { "name": "变异得分", "path": "mutationScore", "min": 60 },
  { "name": "有效变异", "path": "validMutants", "min": 1 },
  { "name": "未完成变异", "path": "incompleteMutants", "equals": 0 },
  { "name": "重复率", "path": "duplicationPercentage", "max": 3 }
]
```

数值来自工具实际运行的结果，不能写死为示例值。脚本在原工具失败、结果缺失或解析失败时也应非零退出，不能只生成一张“成功”摘要。对变异工具，按其文档核对 killed、survived、no coverage、timeout、invalid 等分母；等价变异及忽略项应由用户审查。

## 直接读取现成报告

- Istanbul summary JSON 可直接配置 `total.lines.pct`、`total.branches.pct`、`total.functions.pct`，并为 `total.lines.total` 配置正下限；本包只判定所配置的数字，不额外验证 Istanbul 的百分比分母。
- LCOV 使用 `lines`、`branches`、`functions` 百分比，以及 `linesFound/linesHit` 等计数；零分母维度不产生百分比，要求该维度的门槛会报缺失。
- JUnit 使用 `tests`、`passed`、`failures`（包括 errors）、`skipped`、`successRate`。每个检查读取一个 XML；多文件结果由项目脚本汇总，或者为不同 suite 配置独立检查。没有测试/全跳过/报告中存在失败时自动不通过。
- Text 报告只验证本次存在且更新，内容不进行语义判断；是否发现问题依赖命令退出码，不能配置数值门槛。

若工具只提供原始事件流、SARIF 或工具专用报告，请先通过项目脚本转换。工具没有理解的格式不会被当成质量通过。

## 性能与范围

检查按配置顺序运行，每项独立受时间与输出限制控制，失败后仍继续收集其余结果。耗时较长的变异测试可设置单项 timeoutMs（上限十分钟）；更大的任务需拆分或在宿主任务中实现取消和分片。本版没有并行运行、缓存或增量扫描，不会把未执行的部分当作通过。

实际扫描范围由用户的工具配置决定。质量包不能自动证明测试覆盖了所有业务要求，也不把高覆盖率等同于正确性。

## AI test-first task manifest

Create a task through `code_quality_gate_begin`, or write `.code-quality-gate/tasks/FEATURE-001.json`:

```json
{
  "version": 1,
  "id": "FEATURE-001",
  "title": "Apply the free-shipping threshold",
  "requirements": ["Orders at or above 100 have no base shipping cost"],
  "testFiles": ["tests/test_shipping.py"],
  "codeFiles": ["src/shipping.py"],
  "testChecks": ["acceptance"],
  "protectedFiles": ["quality_adapter.py", ".code-quality-gate/ci-setup.sh"],
  "maxAttempts": 12
}
```

Paths must be explicit files inside the project, without globs. Every test check must be required and produce JUnit. Include all changed implementation files and all relevant helpers/adapters; the gate only snapshots files declared by the task, plus its own manifest and quality configuration. The agent must not omit files to avoid validation. Protected files must exist before red is recorded.

The JUnit parser exposes `assertionFailures`, `errors` and `loadingErrors` in addition to `failures` (which still includes errors). A red phase requires failed acceptance checks with nonzero exit codes, failing assertions, positive test counts, no skips/errors, and no known loading-failure signatures. This relies on the runner correctly classifying JUnit failures; it is not universal semantic exception analysis.

The CLI saves both the expected red audit failure and whether it qualified as workflow evidence. Green runs the frozen testPlan.iterationChecks (or every configured check when absent), consumes an attempt and requires changed implementation, frozen acceptance inputs, and stable files during execution. The final gate always reruns all configured checks; a stored green result alone does not grant readiness.

`.code-quality-gate/active.json` selects the task verified by the default final gate. Older task evidence is retained as history; it is not all revalidated against code changed by later tasks. Repository policy and trusted CI determine how task scope and historical evidence are reviewed.

Optional focused iteration checks and full-gate behavior are documented in [test plans](test-plans.md).

<p align="center">
  <img src="https://raw.githubusercontent.com/iceSheep2003/code-quality-gate/main/assets/logo.svg" width="72" height="72" alt="Code Quality Gate">
</p>
<h1 align="center">Code Quality Gate</h1>
<p align="center">English · <a href="https://github.com/iceSheep2003/code-quality-gate/blob/main/README.zh-CN.md">简体中文</a></p>
<p align="center">
  <a href="https://github.com/iceSheep2003/code-quality-gate/actions/workflows/ci.yml"><img src="https://github.com/iceSheep2003/code-quality-gate/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/code-quality-gate"><img src="https://img.shields.io/npm/v/code-quality-gate" alt="npm version"></a>
  <a href="https://github.com/iceSheep2003/code-quality-gate/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

**`cqg` runs your project's tests and quality checks, records each attempt, and verifies the result before merge.** It gives coding agents a test-first workflow through project instructions, a bundled skill and an MCP server.

The checks use your existing toolchain. Python, Java, Go, Rust and other languages connect through commands and JSON, JUnit or LCOV reports. JavaScript and TypeScript also have built-in static analysis.

![HTML report from a real Python test and coverage run](https://raw.githubusercontent.com/iceSheep2003/code-quality-gate/main/assets/report-preview-en.png)

The same offline HTML file keeps every recorded task and iteration, including failed attempts.

## Get started

Requires **Node.js 22.13+** and your project's test tools. In the project directory:

```sh
npx code-quality-gate setup
```

Setup adds instructions to `AGENTS.md` and `CLAUDE.md`, installs the workflow skill, and writes MCP configuration and a GitHub Actions template. It preserves existing instructions and creates `quality.config.json` if it is missing.

Your coding agent then configures checks in that file and declares the task's requirements, acceptance tests and implementation files. The [Python example](https://github.com/iceSheep2003/code-quality-gate/tree/main/examples/python) and [configuration reference](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md) show the required inputs. Setup does not select tests or thresholds for you.

The npm package is `code-quality-gate`; the installed command is `cqg`. For regular use:

```sh
npm install -g code-quality-gate
```

## Test-first workflow

Once the agent has created a task manifest, a typical cycle is:

```sh
cqg red FEATURE-001
# Implement the feature, then rerun green after each change.
cqg green -n "Handle empty input"
cqg gate
```

`red` requires failing assertions in a JUnit acceptance report. Loading errors, skipped tests and an already-passing suite do not qualify. After red, tests, requirements, adapters and thresholds are frozen for that task. `green` runs all configured checks and records the attempt; the default budget is 12 attempts. `gate` reruns the checks and rejects implementation changes made after the accepted green result.

The agent writes and revises the code. `cqg` executes checks and returns evidence and failures for the next iteration. It does not start an AI agent by itself. See the [workflow skill](https://github.com/iceSheep2003/code-quality-gate/blob/main/skills/code-quality-gate/SKILL.md) for the full procedure.

## Choose the quality requirements

Set a minimum, maximum or exact value for numeric metrics. Other checks can use the command's exit status.

| Check | Input |
| --- | --- |
| Test counts, failures, skips and success rate | JUnit XML |
| Line, branch and function coverage | LCOV or JSON |
| Mutation score, surviving mutants, duplication or custom metrics | JSON from the project's tools or adapter |
| Type checking, linting and builds | Command exit status |
| JS/TS complexity, nesting, function size and dependency cycles | Built-in `cqg check` |

A missing metric, stale report, tool error or timeout cannot pass. Coverage and mutation tools must be installed and configured in the target project. Each metric is evaluated separately; there is no combined quality grade.

[Tool adapters and task manifests](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md) · [Built-in JS/TS checks](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/js-ts-checks.md)

## Read the results

Open **`.quality/code-quality-gate/report.html`** after any audit, red, green or gate run. Each run updates this one file with:

- Metric trends and the thresholds used in each iteration.
- Task, phase, time, change notes, changed files and code fingerprints.
- Check results, duration, failure reasons and recorded tool output.
- Expandable complete records, plus filters, English/Chinese labels and printing.

The desktop report works offline. Green marks values within their configured bounds, red marks failures, and amber marks thresholds. Unmeasured values remain distinct from zero. Workflow acceptance, check results and merge readiness appear separately: an accepted red phase still contains failing tests.

Markdown summaries and a JSONL history are saved alongside the HTML. The report currently includes aggregate coverage and test results; source-line coverage and individual test-case views require richer adapters.

[HTML report reference](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/html-reports.md) · [History fields](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/history.md)

## Commands and integration

| Command | Use |
| --- | --- |
| `cqg setup` | Connect the project to a coding agent |
| `cqg mcp` | Start the MCP server in the current project |
| `cqg red <task>` / `cqg green` / `cqg gate` | Record and verify the test-first cycle |
| `cqg status` | Inspect the active task |
| `cqg audit` | Run configured checks without TDD evidence |
| `cqg check` | Run built-in JS/TS static checks |
| `cqg help` | Show all commands and options |

Use `-C <directory>` for another project and `-n "Change note"` to describe an iteration. JSON and SARIF output are available; `-f html` prints HTML. Exit codes are **0** for a pass or accepted phase, **1** for failed checks or evidence, and **2** for configuration or access errors.

For MCP clients, start `cqg mcp` in the project directory, or use `cqg mcp ./my-project`. Clients that do not discover the generated configuration need a one-time manual connection.

To enforce the result on GitHub, make the generated `quality-gate` CI job a required check. Commit task manifests and evidence under `.code-quality-gate/`. Review and protect tests, quality configuration, adapters and CI workflows. Local evidence is writable; repository permissions and trusted CI enforce merge restrictions. Test quality and declared file scope still determine what a passing gate establishes.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run format:check
npm run check
```

CI runs Node 22/24 on Linux, macOS and Windows. The package checks its own source with the default static thresholds.

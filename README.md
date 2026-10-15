<p align="center">
  <img src="https://raw.githubusercontent.com/iceSheep2003/code-quality-gate/main/assets/logo.svg" width="88" height="88" alt="Code Quality Gate logo">
</p>
<h1 align="center">Code Quality Gate</h1>
<p align="center"><strong>Tests first. Measured iterations. A gate before merge.</strong></p>
<p align="center">English · <a href="https://github.com/iceSheep2003/code-quality-gate/blob/main/README.zh-CN.md">简体中文</a></p>
<p align="center">
  <a href="https://github.com/iceSheep2003/code-quality-gate/actions/workflows/ci.yml"><img src="https://github.com/iceSheep2003/code-quality-gate/actions/workflows/ci.yml/badge.svg" alt="Package verification"></a>
  <a href="https://github.com/iceSheep2003/code-quality-gate/releases"><img src="https://img.shields.io/github/v/release/iceSheep2003/code-quality-gate" alt="GitHub release"></a>
  <a href="https://github.com/iceSheep2003/code-quality-gate/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.13-339933" alt="Node.js 22.13 or newer">
</p>

Code Quality Gate gives AI coding agents a test-first acceptance workflow. The agent writes tests, records a real failure, implements the behavior and repeats checks until the configured standards pass. Every iteration adds measured results to a Markdown history. A fresh final gate verifies the code before merge.

The package is **`code-quality-gate`**. The command is **`cqg`**. It runs your project's tools, so the code under test can use any language.

[Install](#install) · [Commands](#commands) · [Agent integration](#agent-integration) · [Reports](#reports-that-keep-the-history) · [Configuration](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md)

## Install

Requires **Node.js 22.13+** and the toolchain used by your project. Install from npm, then connect a project:

```sh
npm install -g code-quality-gate
cd your-project
cqg setup
```

Ask your coding agent to implement a feature. The installed instructions guide it through configuring real checks, writing acceptance tests, recording red, repairing the implementation and running the final gate. Setup leaves existing project configuration in place.

<details>
<summary>Prefer a project-local installation?</summary>

```sh
npm install -D code-quality-gate
npx --no-install cqg setup
```

For a local install, prefix other commands with `npx --no-install` too. The package name is `code-quality-gate`; `cqg` is its bundled executable. [GitHub source and release tarballs](https://github.com/iceSheep2003/code-quality-gate/releases) are alternative installation sources. See [distribution](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/publishing.md) for version pinning and publishing.

</details>

To run setup once without a global installation:

```sh
npx code-quality-gate setup
```

Run that command in the project directory. Use the package name with npx; `npx cqg` refers to a different registry package.

## Commands

Run commands from the project directory. Use `-C <directory>` when working elsewhere.

| Command | Purpose |
| --- | --- |
| `cqg setup` | Install agent instructions, skills, MCP configuration and a CI template |
| `cqg mcp` | Start the MCP server for the current project |
| `cqg red FEATURE-001` | Record failing acceptance tests for a declared task |
| `cqg green` | Run all checks for the active task and record the iteration |
| `cqg gate` | Rerun required checks and verify evidence before merge |
| `cqg status` | Show the active task and latest result |
| `cqg audit` | Run configured checks and save reports without establishing TDD evidence |
| `cqg check` | Run built-in JS/TS static checks |
| `cqg help` | Show every command and option |
| `cqg version` | Show the installed version |

A typical agent cycle is:

```sh
cqg red FEATURE-001
# Implement the behavior. Repeat green after each change.
cqg green -n "Handle the empty-input boundary"
cqg gate
```

The agent creates the task manifest first. A task ID resolves to `.code-quality-gate/tasks/<id>.json`; explicit relative manifest paths also work. Green resumes the task and quality configuration recorded by red. Tests, requirements, adapters and thresholds freeze after red. The default green-attempt budget is 12, configurable from 1 to 100.

Common options: `-C /path/to/project`, `-c custom.json`, `-n "Change note"`, `--json`, `-f sarif`. Existing `code-quality-gate` and `code-quality` commands, long options and explicit `workflow --change ... --phase ...` remain available. `cqg init` creates a JS/TS static configuration; use `cqg setup` for agent integration.

## Agent integration

`cqg setup` adds managed sections to `AGENTS.md` and `CLAUDE.md`, installs the workflow skill under `.agents/skills/` and `.claude/skills/`, writes a local `.mcp.json`, and creates a GitHub Actions gate template. It creates `quality.config.json` only when one is missing. Existing user instructions, unrelated MCP servers and CI files are preserved; customized skills require review.

For an MCP client that needs a server command:

```sh
cqg mcp
```

The client must start it in the project directory. To select another project, use `cqg mcp ./my-project`. Setup generates a configuration that fixes the project root automatically. Clients that do not discover project instructions or MCP configuration need a one-time manual connection.

The MCP server exposes status, setup, begin, red, green, audit and gate tools with the `code_quality_gate_` prefix. Only a successful final gate returns `canMerge: true`. MCP stdout stays reserved for protocol traffic. The connected agent writes the implementation; this package supplies the workflow and measurements.

Read the [packaged skill](https://github.com/iceSheep2003/code-quality-gate/blob/main/skills/code-quality-gate/SKILL.md) and [task/configuration reference](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md) for integration details.

## Bring your own checks

Use existing language tools for tests, coverage, mutation, duplication, complexity or type checking. Configure commands as argv arrays and set thresholds on their real reports. A minimal `quality.config.json`:

```json
{
  "version": 1,
  "audit": {
    "checks": [
      {
        "id": "acceptance",
        "title": "Acceptance tests",
        "command": ["python3", "-m", "pytest", "--junitxml=.quality/tests.xml"],
        "report": ".quality/tests.xml",
        "format": "junit",
        "metrics": [
          { "name": "Tests", "path": "tests", "min": 1 },
          { "name": "Success rate", "path": "successRate", "equals": 100 },
          { "name": "Skipped tests", "path": "skipped", "equals": 0 }
        ]
      }
    ]
  }
}
```

Commands run in the project root without a shell. JSON, JUnit and LCOV support numeric thresholds; command/text checks rely on exit status. Missing metrics, stale or invalid reports, tool errors and timeouts cannot pass. A valid red phase needs failing assertions; already-passing tests, skips and known loading errors do not establish red.

Coverage and mutation scores come from project tools. The package records each metric separately and does not turn coverage into a correctness claim or an invented overall grade. See [adapters](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md), the [Python example](https://github.com/iceSheep2003/code-quality-gate/tree/main/examples/python) and [JS/TS static checks](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/js-ts-checks.md).

## Reports that keep the history

```sh
cqg audit -n "Check the parser change"
cqg audit --json > quality-report.json
cqg audit -f sarif > quality-report.sarif
```

Each audit, red, green and gate appends an observation to `.quality/code-quality-gate/history.jsonl`, then regenerates `history.md`. Tables record the task and phase, timestamp, code fingerprint, changed files, measured metrics, threshold bounds, decisions and change notes. Per-check results include exit status, duration and failure reasons. Earlier measurements remain in the ledger.

Defaults include all threshold metrics, JUnit test counts/results and LCOV percentages. Choose displayed columns through `audit.history.metrics`, including mutation or complexity values supplied by project tools. Missing, error, not-run and actual zero remain distinct. Agent notes describe changes; executed tools supply the numbers.

A [real Python run](https://github.com/iceSheep2003/code-quality-gate/releases/download/v0.6.0/code-quality-gate-history.md) records two failed tests alongside 100% coverage, followed by zero failures after a boundary fix. [History reference](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/history.md) documents every recorded field. Detailed iteration reports and `latest.md` / `latest.json` are saved alongside the history.

## Enforce before merge

The generated CI job is named `quality-gate`. Make it a required check on the target branch. Commit task manifests, evidence and the active-task pointer under `.code-quality-gate/`; generated reports remain untracked and are uploaded as CI artifacts. Later edits to declared implementation files invalidate the green snapshot.

Trusted CI and repository permissions enforce the merge boundary. Protect tests, adapters, quality policy and workflow files from unreviewed changes. Local hashes detect changed inputs, but writable local evidence cannot prove that an agent followed every step. A passing test suite also depends on the requirements and test scope being complete. Project commands run with the caller's permissions.

Exit codes: **0** passed or phase accepted; **1** checks/evidence failed; **2** configuration, arguments or access error. An accepted red phase still records the expected underlying test failure.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run format:check
npm run check
npm pack
```

The package checks its own source with the default static thresholds. CI runs Node 22/24 on Linux, macOS and Windows.

## License

[MIT](https://github.com/iceSheep2003/code-quality-gate/blob/main/LICENSE). Dependencies retain their own licenses; see [third-party notices](https://github.com/iceSheep2003/code-quality-gate/blob/main/THIRD_PARTY_NOTICES.md).

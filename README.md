# Code Quality Gate

**Test-first quality gates for AI coding agents.**

Code Quality Gate gives coding agents a repeatable acceptance workflow: write tests, observe a real failure, implement the behavior, audit each iteration, and pass a fresh gate before merging. It runs the project's own tools, so the implementation can use any language.

[Quick start](#quick-start) · [Agent integration](#agent-integration) · [Configuration](docs/adapters.md) · [Publishing](docs/publishing.md)

## What it does

- **Test-first evidence.** Records failing JUnit assertions before accepting a green implementation. Already-passing tests, skipped tests, missing reports and known loading failures do not establish red.
- **Frozen acceptance criteria.** Hashes the task, tests, configured adapters and quality configuration after red. Changes to them block green.
- **Configurable gates.** Checks test counts, coverage, mutation scores, duplication and any other numeric metric exposed by a project tool.
- **Measured iteration history.** Appends code fingerprints, changed files, actual metrics, policy bounds and agent notes to a durable observation log, then regenerates Markdown comparison tables. Earlier measurements are preserved.
- **Agent integration.** Ships discoverable skills, managed project instructions, a stdio MCP server and a GitHub Actions gate template.

The package coordinates tests and tools. The connected coding agent writes and repairs the implementation. It does not bundle an AI model or infer complete test coverage from a requirement.

## Quick start

Requires **Node.js 22.13+**, plus the toolchain used by the project being tested.

Version 0.5.0 is prepared for npm publication. Until it is published, install the tagged GitHub source or a release tarball; the repository is public:

```sh
npm install --save-dev github:iceSheep2003/code-quality-gate#v0.5.0
npx --no-install code-quality-gate setup
```

After the npm release is published, the equivalent installation is:

```sh
npm install --save-dev code-quality-gate@0.5.0
npx code-quality-gate setup
```

`setup` preserves existing project configuration and adds:

| File | Purpose |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Managed instructions for code changes; existing content is preserved |
| `.agents/skills/code-quality-gate/SKILL.md` | Discoverable test-first workflow skill |
| `.claude/skills/code-quality-gate/SKILL.md` | The same skill for clients using this location |
| `.mcp.json` | Project-local MCP server configuration; preserves unrelated servers |
| `.github/workflows/code-quality-gate.yml` | CI job that runs the final gate and uploads reports |
| `quality.config.json` | Created only if missing; the agent must configure real project checks |

Then ask the agent to implement a feature. It can configure the language tools, write acceptance tests and follow the packaged skill. Clients that do not read project instructions or `.mcp.json` need the one-time integration described below. Installation does not silently run project code or modify a repository through npm lifecycle hooks.

The generated CI workflow uses the npm release. Publish that release before enabling the workflow. Project-specific dependency installation belongs in `.code-quality-gate/ci-setup.sh`, which the agent can prepare.

## Agent integration

MCP clients can start the server with:

```sh
code-quality-gate mcp --root /absolute/path/to/project
```

The server advertises the test-first workflow during initialization and exposes:

| Tool | Action |
| --- | --- |
| `code_quality_gate_status` | Inspect configured checks, active task and last report |
| `code_quality_gate_setup` | Install project instructions, skills and CI template |
| `code_quality_gate_begin` | Declare a task, affected files and iteration budget |
| `code_quality_gate_red` | Run acceptance tests and freeze valid failing-test evidence |
| `code_quality_gate_green` | Audit the implementation and record a passing snapshot |
| `code_quality_gate_audit` | Save an independent diagnostic report |
| `code_quality_gate_gate` | Verify evidence and rerun all required checks before merging |

Only a successful final gate returns `canMerge: true`. Each tool is restricted to the project root selected when starting the server. Commands still run with the caller's permissions; the server is not a sandbox.

For agents using the CLI, the equivalent sequence is:

```sh
code-quality-gate workflow --change .code-quality-gate/tasks/FEATURE-001.json --phase red
# The agent implements the behavior and repeats green as needed.
code-quality-gate workflow --change .code-quality-gate/tasks/FEATURE-001.json --phase green
code-quality-gate gate
```

A task declares requirements, explicit test/implementation files and required JUnit check IDs. The bundled [skill](skills/code-quality-gate/SKILL.md) defines the full workflow. [Configuration](docs/adapters.md) includes a task example. The default green-attempt budget is 12, configurable from 1 to 100. Exhausting it preserves failure instead of reporting success or looping indefinitely.

## Bring your own checks

A minimal `quality.config.json` can run a project's existing tests:

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

Commands are argv arrays, executed in the project root with `shell: false`. JSON, JUnit and LCOV support numeric thresholds; text reports and command-only checks rely on exit status. Reports must be generated by the current check. Unknown metrics, malformed/stale reports, tool errors and timeouts cannot pass.

Coverage and mutation scores must come from real tools. Code Quality Gate does not derive a mutation score from coverage or combine unrelated metrics into a single quality grade. Tool versions, scanning scope and thresholds belong to the project.

The [Python example](examples/python) uses only the standard library. Built-in [JS/TS static checks](docs/js-ts-checks.md) remain available through `code-quality-gate check`.

## Reports, history and exit codes

```sh
code-quality-gate audit --note "Describe the implementation change" > quality-report.md
code-quality-gate audit --json > quality-report.json
code-quality-gate audit --format sarif > quality-report.sarif
```

An ordinary audit produces a compact report:

```md
# Code quality report

**Status:** FAIL

| Check | Status | Metrics | Details |
| --- | --- | --- | --- |
| Coverage | FAILED | Branch coverage: 67 (>= 75) | Branch coverage: 67; required >= 75 |
```

Each CLI/MCP audit or workflow phase appends to `.quality/code-quality-gate/history.jsonl` and updates `history.md`. The tables compare each iteration's code fingerprint, changed filenames, metrics, thresholds, decision and optional `--note`. Detailed reports are retained under the task directory, with `latest.md` and `latest.json` pointing to the most recent result.

Defaults record all threshold metrics plus JUnit test counts/results and LCOV coverage. `audit.history.metrics` selects the displayed columns, including mutation score, duplication or complexity paths supplied by project tools. Unmeasured values stay missing/error/not-run. See the [history specification](docs/history.md) for the exact recorded fields and configuration.

A valid red phase is accepted while its underlying tests still fail; both facts are retained. Human/agent notes never replace measured numbers.

| Exit code | Meaning |
| --- | --- |
| `0` | Audit/gate passed, or the requested red/green phase was accepted |
| `1` | Checks, thresholds or workflow requirements did not pass |
| `2` | Invalid arguments, configuration or inaccessible files |

Commit task manifests, evidence and the active-task pointer under `.code-quality-gate/`. Reports, machine-specific MCP configuration and runtime locks remain untracked. Any later change to a declared implementation file invalidates its green snapshot until green runs again.

## Merge enforcement

The generated GitHub Actions job is named `quality-gate`. Make it a required status check for the target branch and disable bypasses where appropriate. Platform permissions and account plans determine whether those rules are available. Code Quality Gate reports readiness; it does not grant itself permission to merge.

Instructions and local hashes help agents follow the workflow and detect changed inputs. For stronger enforcement, use trusted CI and protect tests, adapters, workflow files and quality policy from unreviewed changes. Local writable evidence cannot cryptographically prove that an agent followed every step, and a passing suite cannot prove that every requirement was specified.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run format:check
npm run check
npm pack
```

The package checks its own source using the same default static thresholds. CI covers Node 22/24 on Linux, macOS and Windows. A failed CI job is a failed check, not a platform exemption.

## License

[MIT](LICENSE). Third-party dependencies retain their licenses; see [notices](THIRD_PARTY_NOTICES.md).

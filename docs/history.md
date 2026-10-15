# Iteration history

Every CLI/MCP `audit`, `workflow` red/green and final `gate` appends an observation and regenerates a Markdown table. The agent reads that table, changes the implementation, and records the next check. Earlier observations stay in the ledger.

## Files

| File | Purpose |
| --- | --- |
| `.quality/code-quality-gate/history.md` | Project-wide iteration, metric and check-execution tables |
| `.quality/code-quality-gate/<task-id>/history.md` | The same tables limited to one task |
| `.quality/code-quality-gate/history.jsonl` | Full observations, one JSON object per iteration |
| `.quality/code-quality-gate/report.html` | The single offline report containing all tasks, measurements and recorded diagnostics |
| `.quality/code-quality-gate/latest.md` | Detailed report for the most recent run |

A recorded iteration is a tool invocation, not every keystroke. The packaged skill instructs the agent to run green after each implementation iteration. Edits without an audit do not generate invented test results.

## What is recorded

Each observation contains:

- Global sequence number, per-task iteration, run identifier, UTC time and package version.
- Task identifier/title and phase: red, green, audit or final gate.
- Whether the phase was accepted, whether the underlying audit passed, and whether the final gate granted merge readiness. A valid red phase is accepted while its tests still fail.
- Git commit when available, full fingerprint and individual hashes of declared implementation files, and filenames changed since the preceding observation for that task. The first observation is a baseline. File deletion is explicit. This is a fingerprint record, not a stored source-code diff.
- Each tracked metric's check ID, exact report path, label, actual value, min/max/equals bounds for that iteration, and passed/failed/missing/error/not-run status.
- Every executed check's status, required/optional flag, exit code, elapsed milliseconds and failure reasons.
- The agent's optional change note. Notes describe intent; they are not the source of numeric measurements.

An independent audit has no declared task source scope, so its code fingerprint is marked not-declared; a Git commit alone does not identify uncommitted edits. For implementation tracking, use the task workflow with all affected codeFiles listed.

## Which metrics appear

By default, the history records all configured threshold metrics, plus these standard report measurements:

| Report | Default recorded measurements |
| --- | --- |
| JUnit | tests, passed, failures (including errors), errors, skipped, successRate |
| LCOV | lines, branches, functions percentages |
| Custom JSON | Configured threshold metrics; extra metrics can be selected explicitly |
| Command/text | Execution status and duration; no numeric score is invented |

Coverage, mutation, duplication and complexity appear when real tools produce them and the project configures their paths. Missing is not zero. A check omitted from the red-only acceptance run is not-run. A crashed tool is error. Threshold failure remains separate from an execution error.

## Select a compact table

Add `history` inside the existing `audit` configuration. Each selector references a configured check ID and a numeric report path:

```json
{
  "history": {
    "metrics": [
      { "check": "acceptance", "path": "tests", "label": "Tests" },
      { "check": "acceptance", "path": "failures", "label": "Failed tests" },
      { "check": "coverage", "path": "lines", "label": "Line coverage (%)" },
      { "check": "coverage", "path": "branches", "label": "Branch coverage (%)" },
      { "check": "mutation", "path": "mutationScore", "label": "Mutation score (%)" },
      { "check": "duplication", "path": "percentage", "label": "Duplication (%)" }
    ]
  }
}
```

This fragment belongs under `audit` alongside its `checks`. All referenced check IDs must exist. Up to 32 displayed columns are supported; the default table also shows at most 32 columns, while JSONL retains all configured threshold measurements. Selecting display columns does not execute an extra detector or enforce a threshold; use the corresponding `checks[].metrics` rules for enforcement. All configured threshold metrics remain in JSONL even when a shorter display is selected.

Each numeric table cell carries the bounds used for that observation, so later policy edits cannot make earlier results appear to have met a different policy. The latest configured display selection controls the visible columns; the full recorded measurements remain available in JSONL.

## Add a change note

```sh
cqg green --note "Handle the empty-input boundary"
cqg audit --note "Check the parser extraction"
cqg gate --note "Final verification before merge"
```

MCP red/green/audit/gate tools accept the same optional `note` field. Notes are limited to 1,000 characters. Markdown table content is escaped.

## Consistency and persistence

Appending history uses a project lock. Earlier JSONL lines are preserved; each new line includes the previous line's hash and its own consistency hash. A corrupt/truncated or inconsistently edited ledger stops recording instead of silently replacing history. If Markdown is deleted or edited, a later observation regenerates it from the ledger.

This consistency chain detects accidental edits, not a hostile actor who can rewrite every file and recompute hashes. Protect trusted CI inputs separately. Histories live under the ignored `.quality/` directory; the generated CI workflow uploads that directory as an artifact. Cross-machine or cross-run retention requires preserving/downloading that artifact or using your own storage. Task red/green evidence remains separate under `.code-quality-gate/` and should be committed as documented in the main README.

HTML is regenerated from the same validated ledger into a single `report.html` on every run. No per-task or per-run HTML files are created. See [HTML reports](html-reports.md). `html` and `history.html` in CLI/MCP results both identify this file; existing report fields retain their Markdown paths.

New observations also preserve each check's numeric metrics, threshold definitions, report format and recorded violations/tool output, plus the audit's summary and start time. Legacy observations without these optional fields remain unchanged. The HTML full-record section includes every recorded field, even metrics omitted from the compact table.

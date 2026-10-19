# Test plans

A task can run a focused set of checks during implementation while reserving the full suite for the final gate. This avoids rerunning expensive regression, coverage or mutation jobs after every edit.

Define the plan **before recording red**, alongside the task requirements and tests:

```json
{
  "version": 1,
  "id": "SHIPPING",
  "title": "Correct the shipping threshold",
  "requirements": ["Orders at or above 100 receive free shipping"],
  "testFiles": ["tests/test_shipping.py", "tests/test_checkout.py"],
  "codeFiles": ["src/shipping.py"],
  "testChecks": ["shipping-acceptance"],
  "protectedFiles": ["quality_adapter.py"],
  "testPlan": {
    "iterationChecks": ["shipping-acceptance", "lint"],
    "rationale": "The edit changes the shipping boundary. Run its acceptance tests and lint per iteration; defer checkout regression, complete coverage and mutation analysis to the full gate."
  },
  "maxAttempts": 12
}
```

The check IDs must already exist in `quality.config.json` under `audit.checks`. In this example those checks include `shipping-acceptance`, `lint`, `checkout-regression`, `coverage` and `mutation`.

| Phase | Checks executed |
| --- | --- |
| `red` | Task acceptance checks listed in `testChecks` |
| `green` | `testPlan.iterationChecks`, including every acceptance check |
| `gate` | **All** configured checks, including deferred checks |
| `audit` | All configured checks, independent of a task plan |

A task without `testPlan` retains the previous behavior: green and gate both run all configured checks. Existing tasks and evidence remain usable.

## Preview without running tests

```sh
cqg plan SHIPPING
cqg plan SHIPPING --json
cqg red SHIPPING
# Change implementation, then repeat focused checks as needed.
cqg green -n "Include the boundary value"
cqg gate
```

`cqg plan` without an ID previews the active task selected by red. Use `-C` and `-c` for another project or configuration. Previewing does not execute checks, create evidence, consume attempts or authorize merging.

MCP clients can call `code_quality_gate_plan` with an optional task manifest path and config filename. `code_quality_gate_begin` accepts the same `testPlan` object as a task manifest.

## Choosing the scope

The coding agent should inspect the affected code and tests, then explain which checks give useful feedback during implementation and which can wait. Keep changed behavior and relevant boundary cases in the acceptance checks. Shared infrastructure or a broad refactor may justify running most or all checks on every iteration.

A plan selects **whole configured checks**. If a command currently runs the entire test suite, split it into focused acceptance and broader regression commands before recording red. The tool does not infer a cross-language dependency graph or select individual test cases inside a command.

Checks execute in their configured order. Include any producer needed by another selected check, or make each check produce its own inputs. For example, a coverage check must run the instrumented tests it measures, or follow the selected instrumented test check. The plan does not infer dependencies between tool-specific report files.

## Evidence and reports

The task, plan, tests, protected adapters and quality configuration freeze at red. Removing checks or changing the rationale afterward invalidates the task's evidence. Unknown check IDs, duplicate IDs, empty rationales and plans that omit an acceptance check are rejected before any checks execute.

Passing focused green means the selected required checks passed. It never grants `canMerge: true`. The final gate verifies the current snapshots and executes every configured check afresh. Failures in deferred required checks block the gate.

The Markdown and HTML iteration tables list executed and deferred check IDs. JSON results and the JSONL ledger retain the phase, selection mode, rationale and complete selection under `audit.execution`. Metrics from deferred checks are `not-run`, with no invented values or reused passing scores. Check execution tables contain actual executions only.

There is no cached test success in this feature. Each selected check executes on every green, and every configured check executes at gate. This keeps the optimization explicit and reviewable.

# HTML reports

Every CLI/MCP audit, red, green and final gate updates **one HTML file**:

```text
.quality/code-quality-gate/report.html
```

It contains all recorded tasks and iterations, metrics and bounds, source fingerprints and changed files, check results, recorded tool diagnostics and expandable full JSON records. Every recorded metric is included, even when only a selected subset appears in the compact table. No per-run or per-task HTML files are generated. Markdown and JSON artifacts remain available for agents. The HTML makes no network requests and needs no server, external font or CDN.

Open this file in a desktop browser. The interface is designed for a developer's desktop workspace, with light surfaces, navy text, blue trends, green passing values, red failures and amber threshold marks. The **中文 / EN** button switches interface labels; metric names, filenames and agent notes retain their original text. Task selection filters tables and charts. Phase, decision and text search filter the tables only. Reset clears all filters. All rows remain readable without JavaScript; interactive filters and language switching require it. Print / PDF invokes the browser's print dialog for the currently visible content.

The file is rewritten from the validated append-only ledger after each observation; reopen/reload it to see new results. Earlier numeric facts are preserved. Reports contain filenames, metrics, notes and tool diagnostics, so review them before sharing. They do not embed the source code.

## Values and decisions

The workflow decision, underlying audit and merge readiness are distinct. An accepted red has a failing underlying audit. Accepted green alone never grants merge readiness. Only an accepted gate can report READY. A project-wide dashboard's heading describes its latest observation, not an aggregate merge decision for every task.

Metrics without configured thresholds say **measured**. A value meeting its threshold does not imply that its whole check or workflow passed. Failed, missing, error and not-run remain separate; real zero is displayed as zero. Coverage and mutation measurements appear only when configured tools produce them.

Charts group by task and use recorded sequence numbers on the horizontal axis. Lines stop at missing/error/not-run observations. Different tasks are never joined into one line. Dashed marks show that observation's actual min/max/equals bounds; they are not a new computed target. Axes are scaled independently per metric, with no synthetic overall score. Hover a point for its value and policy; the measurement table gives the full accessible numeric record. Display selection follows `audit.history.metrics`, limited to 32 columns, while JSONL retains all recorded threshold measurements.

The report currently shows aggregate metrics and check diagnostics. It does not add JaCoCo-style source-line coverage or individual test-case drilldowns: the existing input adapters summarize JUnit and LCOV. Source-level views would require preserving that detail from a detector.

The iteration table also shows each task phase’s test plan, executed check IDs and deferred IDs. Focused green is not a full-suite pass. Deferred metrics remain `not-run`; the final gate executes all configured checks. See [test plans](test-plans.md).

## CLI and API

```sh
cqg audit
cqg green
cqg gate
# Open the same .quality/code-quality-gate/report.html after any of these runs.
```

Use `-f html` to print this same report to stdout if a caller explicitly needs it. `cqg check -f html` renders a standalone static-analysis view to stdout.

Audit/workflow exit codes retain their meaning when HTML is selected: 0 passed or phase accepted, 1 checks/evidence failed, 2 configuration/access error. Configuration failures render as HTML when `-f html` is requested. Built-in `check` shows per-function JS/TS complexity, nesting, parameter, statement and line measurements plus violations. It does not create workflow evidence or history.

The JSON/MCP result adds `html` and `history.html`; both point to the same cumulative report. Existing `report` and `history.markdown` still point to Markdown. The low-level `runAudit` API remains an in-memory runner; `runProjectAudit` persists artifacts. The exported `reportHtml({entries, result})` renderer can render recorded observations and optional current check details. New ledger observations retain available violations/tool output; older observations show only the data they originally recorded.

All project-provided labels, notes and tool output are escaped. A content security policy permits only the embedded script and style hashes. Filtering uses DOM text and attributes, with no HTML insertion from user content. The generated CI workflow uploads the complete report directory, including HTML.

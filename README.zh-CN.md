<p align="center">
  <img src="https://raw.githubusercontent.com/iceSheep2003/code-quality-gate/main/assets/logo.svg" width="72" height="72" alt="Code Quality Gate">
</p>
<h1 align="center">Code Quality Gate</h1>
<p align="center"><a href="https://github.com/iceSheep2003/code-quality-gate/blob/main/README.md">English</a> · 简体中文</p>
<p align="center">
  <a href="https://github.com/iceSheep2003/code-quality-gate/actions/workflows/ci.yml"><img src="https://github.com/iceSheep2003/code-quality-gate/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/code-quality-gate"><img src="https://img.shields.io/npm/v/code-quality-gate" alt="npm 版本"></a>
  <a href="https://github.com/iceSheep2003/code-quality-gate/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 许可证"></a>
</p>

**`cqg` 执行项目的测试和质量检查，记录每轮结果，并在合并前重新验证。** 它通过项目指令、内置 skill 和 MCP 服务，让编程 AI 按照先写测试、再改实现的流程工作。

检查使用项目已有的工具。Python、Java、Go、Rust 等语言通过命令和 JSON、JUnit、LCOV 报告接入；JavaScript 和 TypeScript 另有内置静态分析。

![真实 Python 测试与覆盖率运行生成的 HTML 报告](https://raw.githubusercontent.com/iceSheep2003/code-quality-gate/main/assets/report-preview-zh.png)

所有已记录的任务和迭代都保存在同一个离线 HTML 中，包括失败的尝试。

## 开始使用

需要 **Node.js 22.13+**，以及项目自身的测试工具。在项目目录执行：

```sh
npx code-quality-gate setup
```

Setup 会向 `AGENTS.md` 和 `CLAUDE.md` 添加指令，安装工作流 skill，生成 MCP 配置和 GitHub Actions 模板。已有指令会保留；没有 `quality.config.json` 时会创建该文件。

接下来由编程 AI 在配置中接入检查，并声明本次任务的需求、验收测试和实现文件。[Python 示例](https://github.com/iceSheep2003/code-quality-gate/tree/main/examples/python)和[配置说明](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md)提供了完整输入。Setup 不会替项目决定测试内容或质量门槛。

npm 包名为 `code-quality-gate`，安装后的命令为 `cqg`。经常使用时可以安装：

```sh
npm install -g code-quality-gate
```

## 先写测试，再改实现

AI 创建任务清单后，执行流程如下：

```sh
cqg red FEATURE-001
# 编写实现，每次修改后重新运行 green。
cqg green -n "处理空输入"
cqg gate
```

`red` 要求 JUnit 验收报告中存在断言失败。加载错误、跳过测试或原本就通过的测试不能作为 red 证据。记录 red 后，该任务的测试、需求、适配器和门槛会被冻结。`green` 执行所有已配置的检查并记录本轮结果，默认最多尝试 12 次。`gate` 重新运行检查；通过 green 后再次修改实现，会使原先的结果失效。

AI 负责写代码和修改代码，`cqg` 负责执行检查、返回证据和失败原因。这个包本身不会启动 AI。完整流程见[工作流 skill](https://github.com/iceSheep2003/code-quality-gate/blob/main/skills/code-quality-gate/SKILL.md)。

## 设置质量要求

数值指标可以设置下限、上限或精确值。其他检查可以根据命令退出状态判定。

| 检查内容 | 数据来源 |
| --- | --- |
| 测试数量、失败数、跳过数、成功率 | JUnit XML |
| 行、分支、函数覆盖率 | LCOV 或 JSON |
| 变异得分、存活变异、重复率及自定义指标 | 项目工具或适配器输出的 JSON |
| 类型检查、Lint、构建 | 命令退出状态 |
| JS/TS 复杂度、嵌套、函数大小、依赖环 | 内置 `cqg check` |

指标缺失、报告过期、工具出错或超时都不能通过。覆盖率和变异测试工具需要在目标项目中安装、配置。每个指标单独判定，不合成为一个质量总分。

[工具接入与任务清单](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md) · [内置 JS/TS 检查](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/js-ts-checks.md)

## 查看结果

运行 audit、red、green 或 gate 后，打开 **`.quality/code-quality-gate/report.html`**。每轮都会更新这个文件，保留：

- 指标趋势，以及每轮实际使用的门槛。
- 任务、阶段、时间、修改说明、修改文件和代码指纹。
- 检查结果、耗时、失败原因及已记录的工具输出。
- 可展开的完整记录，以及筛选、中英文切换和打印功能。

报告面向桌面浏览器，支持离线打开。绿色表示指标达标，红色表示失败，琥珀色标出门槛。未测量值与真实的零值分别显示。阶段是否被接受、底层检查结果和是否允许合并分别列出：red 阶段被接受时，测试依然是失败的。

HTML 旁边还会保存 Markdown 摘要和 JSONL 历史。目前报告展示汇总覆盖率和测试结果；逐行源码覆盖率及单个测试用例视图需要接入更详细的数据。

[HTML 报告说明](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/html-reports.md) · [历史记录字段](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/history.md)

## 命令与集成

| 命令 | 用途 |
| --- | --- |
| `cqg setup` | 将项目接入编程 AI |
| `cqg mcp` | 为当前项目启动 MCP 服务 |
| `cqg red <task>` / `cqg green` / `cqg gate` | 记录并验证测试优先流程 |
| `cqg status` | 查看当前任务 |
| `cqg audit` | 运行已配置的检查，不建立 TDD 证据 |
| `cqg check` | 运行内置 JS/TS 静态检查 |
| `cqg help` | 查看全部命令和选项 |

使用 `-C <目录>` 指定其他项目，使用 `-n "修改说明"` 记录本轮改动。支持 JSON 和 SARIF 输出；`-f html` 输出 HTML。退出码 **0** 表示检查通过或阶段被接受，**1** 表示检查或证据不通过，**2** 表示配置或访问错误。

MCP 客户端可在项目目录启动 `cqg mcp`，也可以使用 `cqg mcp ./my-project`。不能自动发现生成配置的客户端，需要手动连接一次。

如需在 GitHub 上阻止未达标的代码合并，将生成的 `quality-gate` CI 任务设为必需检查。任务清单和证据需要提交到 `.code-quality-gate/`。测试、质量配置、适配器和 CI 工作流应受审查保护。本地证据可以被改写，实际合并限制由仓库权限和可信 CI 执行。测试本身的质量及声明的文件范围，决定了通过门禁能证明什么。

## 开发

```sh
npm ci --ignore-scripts
npm test
npm run format:check
npm run check
```

CI 在 Linux、macOS 和 Windows 上运行 Node 22/24。本包使用默认静态门槛检查自身源码。

<p align="center">
  <img src="https://raw.githubusercontent.com/iceSheep2003/code-quality-gate/main/assets/logo.svg" width="88" height="88" alt="Code Quality Gate 标识">
</p>
<h1 align="center">Code Quality Gate</h1>
<p align="center"><strong>先写测试，逐轮记录，达标后再合并。</strong></p>
<p align="center"><a href="https://github.com/iceSheep2003/code-quality-gate/blob/main/README.md">English</a> · 简体中文</p>
<p align="center">
  <a href="https://github.com/iceSheep2003/code-quality-gate/actions/workflows/ci.yml"><img src="https://github.com/iceSheep2003/code-quality-gate/actions/workflows/ci.yml/badge.svg" alt="跨平台检查"></a>
  <a href="https://github.com/iceSheep2003/code-quality-gate/releases"><img src="https://img.shields.io/github/v/release/iceSheep2003/code-quality-gate" alt="GitHub 版本"></a>
  <a href="https://github.com/iceSheep2003/code-quality-gate/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 许可证"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.13-339933" alt="需要 Node.js 22.13 或更新版本">
</p>

Code Quality Gate 为 AI 编程提供一套测试先行的验收流程：AI 先写测试，记录真实失败，再实现功能并反复检查，直到满足项目设置的质量门槛。每轮检测结果都会追加到 Markdown 历史表格中，合并前还需要通过一次最新检查。

安装包叫 **`code-quality-gate`**，命令统一叫 **`cqg`**。它调用项目自己的工具，被检查的代码可以使用任何语言。

[安装](#安装) · [命令](#命令) · [接入-ai](#接入-ai) · [累计报告](#累计报告) · [配置参考](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md)

## 安装

需要 **Node.js 22.13+**，以及被测项目所需的语言工具链。从 npm 安装后，在项目目录接入：

```sh
npm install -g code-quality-gate
cd your-project
cqg setup
```

然后把功能需求交给编程 AI。安装的指令会引导 AI 配置真实检查工具、编写验收测试、记录失败、修改实现并执行最终门禁。已有的项目配置会保留。

<details>
<summary>只在当前项目安装</summary>

```sh
npm install -D code-quality-gate
npx --no-install cqg setup
```

本地安装后，其他命令也加上 `npx --no-install` 前缀。包名为 `code-quality-gate`，`cqg` 是它提供的命令。[GitHub 源码和 Release 安装包](https://github.com/iceSheep2003/code-quality-gate/releases)也可安装。版本固定与发布方式见[分发说明](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/publishing.md)。

</details>

不做全局安装，也可以在项目目录直接运行：

```sh
npx code-quality-gate setup
```

npx 使用包名；`npx cqg` 会查找另一个同名包。

## 命令

在项目目录运行；从其他目录操作时，用 `-C <目录>` 指定项目。

| 命令 | 用途 |
| --- | --- |
| `cqg setup` | 安装 AI 指令、Skill、MCP 配置和 CI 模板 |
| `cqg mcp` | 为当前项目启动 MCP 服务 |
| `cqg red FEATURE-001` | 为已声明的任务记录失败验收测试 |
| `cqg green` | 对当前任务运行全部检查，记录本轮结果 |
| `cqg gate` | 在合并前重新检查代码与测试证据 |
| `cqg status` | 查看当前任务和最近结果 |
| `cqg audit` | 执行配置的检测并保存报告，不建立 TDD 证据 |
| `cqg check` | 执行内置 JS/TS 静态检查 |
| `cqg help` | 查看全部命令和参数 |
| `cqg version` | 查看安装版本 |

AI 的常用执行流程：

```sh
cqg red FEATURE-001
# 实现功能，每次修改后重新运行 green。
cqg green -n "处理空输入边界"
cqg gate
```

AI 需要先创建任务清单。任务名对应 `.code-quality-gate/tasks/<任务名>.json`，也可以直接传入清单的相对路径。`green` 自动沿用 `red` 记录的任务和质量配置。记录失败后，测试、需求、适配器和门槛会被冻结。默认最多尝试 12 次，可设置为 1 至 100 次。

常用参数：`-C /项目路径`、`-c custom.json`、`-n "修改说明"`、`--json`、`-f sarif`。原有的 `code-quality-gate`、`code-quality`、完整参数及 `workflow --change ... --phase ...` 仍可使用。`cqg init` 用于创建 JS/TS 静态检查配置；接入 AI 使用 `cqg setup`。

## 接入 AI

`cqg setup` 会在 `AGENTS.md`、`CLAUDE.md` 中加入托管指令，在 `.agents/skills/` 和 `.claude/skills/` 下安装工作流 Skill，写入本地 `.mcp.json`，并创建 GitHub Actions 门禁模板。仅在缺少时创建 `quality.config.json`。原有用户指令、其他 MCP 服务及 CI 文件会保留；已有自定义 Skill 需要审查后再更新。

MCP 客户端需要填写服务命令时，使用：

```sh
cqg mcp
```

客户端需要从项目目录启动服务；指定其他项目可用 `cqg mcp ./my-project`。通过 setup 生成的配置会自动固定项目目录。若客户端不自动读取项目指令或 MCP 配置，需要手动连接一次。

MCP 提供 status、setup、begin、red、green、audit 和 gate 工具，名称前缀为 `code_quality_gate_`。只有最终门禁通过才返回 `canMerge: true`。MCP 的标准输出专用于协议通信。编程 AI 负责修改实现，本包负责工作流与检测记录。

完整规则见[内置 Skill](https://github.com/iceSheep2003/code-quality-gate/blob/main/skills/code-quality-gate/SKILL.md)和[任务与配置说明](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md)。

## 使用项目自己的检测工具

测试、覆盖率、变异测试、重复率、复杂度及类型检查都可以接入已有工具。将执行命令配置为参数数组，再为真实报告中的指标设置门槛。最小 `quality.config.json` 示例：

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

命令在项目根目录运行，不经过 shell。JSON、JUnit 和 LCOV 支持数值门槛；命令或文本检查依赖退出码判定。缺失指标、旧报告、格式错误、工具崩溃或超时都不能通过。记录 red 必须有真实断言失败；原本就通过的测试、跳过项和已知加载错误不能作为失败证据。

覆盖率和变异得分来自实际工具，各项指标独立记录。覆盖率不能证明业务正确，本包也不会把不同指标拼成虚构的综合等级。详见[工具适配](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/adapters.md)、[Python 示例](https://github.com/iceSheep2003/code-quality-gate/tree/main/examples/python)和 [JS/TS 静态检查](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/js-ts-checks.md)。

## 累计报告

```sh
cqg audit -n "检查解析器修改"
cqg audit --json > quality-report.json
cqg audit -f sarif > quality-report.sarif
```

每次 audit、red、green 和 gate 都会向 `.quality/code-quality-gate/history.jsonl` 追加一条记录，并重新生成 `history.md` 表格。记录包含任务、阶段、时间、代码指纹、修改文件、实际指标、当轮门槛、判定结果与修改说明。各检查还会记录退出状态、耗时和失败原因，之前的测量值会保留。

默认记录所有门槛指标、JUnit 测试数量与结果、LCOV 覆盖率。通过 `audit.history.metrics` 选择展示列，也可以加入项目工具提供的变异得分和复杂度。缺失、错误、未运行和真实的零值会分别表示。AI 写修改说明，检测工具提供数值。

[真实 Python 检测记录](https://github.com/iceSheep2003/code-quality-gate/releases/download/v0.6.0/code-quality-gate-history.md)展示了“覆盖率 100% 但仍有 2 项测试失败”，以及修复边界条件后失败数归零的过程。全部记录字段见[历史说明](https://github.com/iceSheep2003/code-quality-gate/blob/main/docs/history.md)。逐轮详细报告、`latest.md` 和 `latest.json` 保存在历史记录旁。

## 合并前执行门禁

生成的 CI 任务名为 `quality-gate`，可在目标分支设为必需检查。任务清单、证据和当前任务指针保存在 `.code-quality-gate/`，需要随代码提交。生成的报告不进入版本控制，由 CI 上传为附件。再次修改声明的实现文件，会使已有 green 快照失效。

实际合并权限由可信 CI 与仓库设置执行。测试、适配器、质量配置和 CI 工作流应受到审查保护。本地哈希能发现输入变化，但可被写入的本地证据不能证明 AI 执行过每一步；测试通过也依赖需求和测试范围完整。项目命令使用调用者的系统权限运行。

退出码：**0** 检查通过或阶段被接受；**1** 检查或证据不通过；**2** 参数、配置或访问错误。red 被接受时，底层测试失败仍会如实记录。

## 开发

```sh
npm ci --ignore-scripts
npm test
npm run format:check
npm run check
npm pack
```

本包用默认静态门槛检查自身源码。CI 在 Linux、macOS 和 Windows 上分别运行 Node 22/24。

## 许可证

[MIT](https://github.com/iceSheep2003/code-quality-gate/blob/main/LICENSE)。依赖保留各自许可证，详见[第三方声明](https://github.com/iceSheep2003/code-quality-gate/blob/main/THIRD_PARTY_NOTICES.md)。

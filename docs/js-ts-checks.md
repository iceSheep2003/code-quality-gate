# 内置 JS/TS 检查及 Node TDD 记录

## 内置 JS/TS 静态检查

拿到交付的 `veritygate-0.4.0.tgz` 后，在需要检查的项目根目录执行：

```sh
npm install --save-dev /实际路径/veritygate-0.4.0.tgz
npx --no-install veritygate check
```

安装包本身不需要 MindLeap 源码、服务端、数据库、API 密钥或联网账户。首次安装会下载 npm 依赖；安装完成后检查可以离线运行。没有发布到 npm，不要把名称当成已存在的公共注册表包。

零配置默认检查项目中的支持语言，排除依赖、构建产物、覆盖率、声明文件、`tests/`、`test/` 和 `*.test.*` / `*.spec.*`。非支持语言不会被分析；没有任何支持的源文件会失败。

正式接入建议显式限定生产代码：

```sh
npx --no-install veritygate init
```

`init` 在根目录生成 `quality.config.json`，不会覆盖已有文件。修改 `include` 为实际目录；默认生成的是 `src`。

```json
{
  "version": 1,
  "include": ["src", "server", "shared"],
  "requireTdd": false,
  "dependencyCycles": true,
  "limits": { "cyclomatic": 10, "cognitive": 15 }
}
```

只列项目真实存在的目录。支持单个文件和 glob，例如 `src/**/*.ts`。非 glob 路径不存在视为配置错误。路径相对项目根目录，使用 `/`，不能越出项目。

`exclude` 未提供时使用默认排除；显式提供时**替换**默认列表，适合需要检查测试代码的项目。若只想增加排除，请复制默认列表再添加路径；完整列表可由 `resolveConfig().exclude` 获取。未知字段、无效阈值、空范围、语法错误均不会假报通过。

## 检查内容

| 检查 | 默认门槛/行为 |
| --- | --- |
| 圈复杂度 | 每函数 ≤10，ESLint modified 口径 |
| 认知复杂度 | 每函数 ≤15，SonarJS 规则 |
| 控制流嵌套 | ≤4 层 |
| 函数参数 | ≤4 个 |
| AST 语句数 | 每函数 ≤40，压缩成一行不能绕过 |
| 有效代码行 | 每函数 ≤80，每文件 ≤500 |
| 函数数量 | 每文件 ≤40 |
| 危险语法 | eval、动态 Function、异步 Promise executor、不可达代码、危险 finally / optional chaining 等 |
| 依赖环 | 范围内相对路径 import、export、字面量 import() / require() 的循环组件 |
| 测试记录 | 可选，核对需求、测试、代码指纹与 red/green 顺序 |

源码中的 `eslint-disable` 不能关闭这些检查。Halstead 体积和可维护性分数仅作诊断，不影响硬门槛。

依赖环解析支持扩展名、省略扩展名、目录 index，以及 TypeScript 对 `.js/.mjs/.cjs` 导入的对应源文件。忽略纯类型 import/export；混合导入作为运行时依赖。仅检查扫描范围内的相对依赖，不解析 tsconfig alias、bundler alias、包 exports、计算出来的路径或外部包，也不会执行模块。`require()` 按名字识别，不做完整变量绑定分析；报告中的 members 是强连通组件，edges 给出真实依赖边。

## 报告与 CI

```sh
npx --no-install veritygate check --json > quality-report.json
npx --no-install veritygate check --format sarif > quality-report.sarif
npx --no-install veritygate check --root /项目绝对路径 --config config/quality.json
npx --no-install veritygate --help
```

支持 `--flag value` 和 `--flag=value`。命令放在参数前。

- 退出 0：通过。
- 退出 1：有阻断问题或测试记录未通过。
- 退出 2：参数、配置、基线或文件访问错误。

JSON 的 `schemaVersion` 当前为 1，包含 `passed`、`violations`、`legacy`、`summary`、`reports`、`limits`、`changedFiles`。每条问题带 rule/metric、文件、行列和诊断；完整代码不会出现在报告里。错误 JSON 也保留同一版本字段。JSON/SARIF 写 stdout，文本配置错误写 stderr。

SARIF 2.1.0 可交给支持该格式的 CI/审查工具；已有基线问题仅在 JSON 的 legacy 中体现，SARIF 默认只包含当前阻断问题。示例见 [examples/ci.yml](../examples/ci.yml)。

## 接入已有项目

先查看当前报告，再明确记录历史问题：

```sh
npx --no-install veritygate check --json
npx --no-install veritygate baseline --accept-existing
npx --no-install veritygate check
```

基线不是修复证明。它按问题指纹和数量匹配；改过函数、新增问题、复制问题、语法错误不能借用旧豁免。基线会记录范围和策略；改变 include/exclude、依赖环开关或阈值会要求重新审查。不要在每次 CI 中自动刷新基线。

`baseline --accept-existing` 会覆盖已有基线，必须通过版本管理和评审控制。本版基线也能豁免当时已有的危险语法及依赖环；希望这些问题永不豁免的项目，暂时不要基线化这些问题，后续可引入按规则配置的基线权限。

## 可选测试记录

普通静态检查默认 `requireTdd:false`。要对生产源码变更强制核对测试记录，设置 `requireTdd:true`，把需求契约放入默认 `quality/changes/`。

```json
{
  "id": "FEATURE-001",
  "title": "有效请求可以保存一次",
  "requirements": [{
    "id": "R1",
    "given": "用户已登录",
    "when": "发送有效保存请求",
    "then": "保存成功且不重复",
    "tests": ["test/save.test.mjs"]
  }],
  "codeFiles": ["src/save.mjs"]
}
```

```sh
npx --no-install veritygate tdd --change quality/changes/FEATURE-001.json --phase red
# 改实现，让相同测试通过
npx --no-install veritygate tdd --change quality/changes/FEATURE-001.json --phase green
npx --no-install veritygate verify --change quality/changes/FEATURE-001.json
npx --no-install veritygate check
```

该可选功能使用 Node 内置测试运行器，支持 `.test.js/.test.mjs/.test.cjs`，不会自动适配 Jest/Vitest。red 需要断言失败，模块缺失、加载失败、原本通过、跳过或 todo 不能充当通过的阶段记录。green 会核对同一需求和测试，并拒绝运行期间代码/测试变化。每次执行最多 60 秒、输出最多 500KB。

纯重构契约可加 `kind:"refactor"` 与非空 `review`，先记录 `--phase baseline`，改实现后记录 green。review 是人工声明，工具不自动证明审查真实性或语义等价。

只核对扫描范围内的现存或新增文件；删除文件、未被契约覆盖的外部依赖变化暂不纳入测试记录判断。本地记录不是防篡改凭证。`check` 不执行项目代码；只有明确运行 `tdd` 时执行项目测试。

## 编程接口

```js
import { analyzeSource, evaluateReport, checkProject, resolveConfig, toSarif } from 'veritygate';
const source = analyzeSource('export const sum=(a:number,b:number)=>a+b;', { filename:'src/sum.ts' });
console.log(evaluateReport([source]));
const project = await checkProject(process.cwd(), resolveConfig({ include:['src'] }));
console.log(toSarif(project));
```

`checkProject` 直接验证调用者配置；`readConfig(root, relativeFilename)` 用于读取项目配置。也导出 baselineProject、createBaseline、analyzeProject、recordPhase、verifyEvidence、validateChange、formatReport、dependencyCycles 和 defaults。

`evaluateReport` 可额外接收 `{coverage:{lines,functions,branches}}`，阈值为 90/90/80。`check` 不采集业务覆盖率；`audit` 可执行项目工具并验证其 LCOV/JSON 指标。不能把 defaults.coverage 当成已经执行了覆盖率门禁。

## 开发和扩展

从源码压缩包解压后：

```sh
npm ci --ignore-scripts
npm test
npm run format:check
npm run check
npm pack
```

包本身使用相同默认质量阈值检查 `src/`，不使用历史豁免。测试覆盖原包行为和通用化场景。`.github/workflows/ci.yml` 提供 Node 22/24、Linux/macOS/Windows 矩阵示例；这些远程环境尚需实际 CI 执行。

语言工具接入参见 [配置说明](adapters.md)。来源与依赖许可证见 [第三方说明](../THIRD_PARTY_NOTICES.md)。

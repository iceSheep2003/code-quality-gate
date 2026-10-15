# Notices

Code Quality Gate was originally derived from MindLeap’s local `packages/backend-quality` tool. It contains no MindLeap business code. The project is distributed under MIT; third-party dependencies retain their own licenses.

本包动态使用下列 npm 依赖；安装依赖时其许可证随依赖包保留。

| 包 | 固定版本 | 上游许可证 |
| --- | --- | --- |
| eslint | 10.12.0 | MIT |
| eslint-plugin-sonarjs | 4.2.2 | LGPL-3.0-only |
| @typescript-eslint/parser | 8.60.1 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| minimatch | 10.2.4 | BlueOak-1.0.0 |
| fast-xml-parser | 5.11.2 | MIT |
| @modelcontextprotocol/sdk | 1.32.1 | MIT |
| zod | 4.6.7 | MIT |
| prettier（开发用） | 3.6.2 | MIT |

锁文件固定依赖树。传递依赖许可证以各 npm 包内声明和 LICENSE 文件为准。本包未将 ESLint、SonarJS 或其依赖的实现复制/捆绑进 tarball。版本升级须重新验证规则行为、基线兼容性和第三方许可。

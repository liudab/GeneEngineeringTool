---
kind: configuration_system
name: 配置系统：基于 Electron-vite 的轻量级构建期配置
category: configuration_system
scope:
    - '**'
source_files:
    - gene-engineering-tool/electron.vite.config.ts
    - gene-engineering-tool/src/main/index.ts
    - gene-engineering-tool/package.json
---

本仓库未实现独立的应用运行时配置系统。项目采用 Electron-vite 脚手架，所有“配置”均集中在构建期配置文件与少量环境变量中，不存在统一的配置加载、分层或热重载机制。

- 构建期配置：`electron.vite.config.ts`（主构建入口）、`postcss.config.js`、`tailwind.config.js`、`tsconfig.json`/`tsconfig.node.json`/`tsconfig.web.json`、`package.json`、`electron-builder.json`。
- 运行期环境变量：仅 `src/main/index.ts` 通过 `process.env['ELECTRON_RENDERER_URL']` 在开发模式切换渲染进程 URL，无其他运行时配置读取逻辑。
- 数据持久化：通过 `src/main/database.ts` 直接操作本地 SQLite 数据库，而非外部配置文件。
- 未发现 `.env`、`.yaml`、`.toml`、`application.properties` 等运行时配置文件，也未发现任何配置解析库（如 dotenv、js-yaml、configstore）的导入或使用。

结论：该仓库没有应用级的配置系统，属于“低”适用度场景。若未来需要引入配置管理，建议在主进程初始化处集中加载（例如使用 `dotenv` + JSON/YAML 文件），并通过 IPC 暴露给渲染进程。
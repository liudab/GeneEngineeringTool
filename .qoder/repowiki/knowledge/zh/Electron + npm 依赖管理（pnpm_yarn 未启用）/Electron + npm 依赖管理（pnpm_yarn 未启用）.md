---
kind: dependency_management
name: Electron + npm 依赖管理（pnpm/yarn 未启用）
category: dependency_management
scope:
    - '**'
source_files:
    - gene-engineering-tool/package.json
    - gene-engineering-tool/package-lock.json
    - gene-engineering-tool/electron-builder.json
---

本项目采用标准的 npm 依赖管理体系，基于 Electron-vite 构建的桌面应用。核心依赖管理策略如下：

**包管理器与锁定文件**
- 使用 npm 作为默认包管理器，通过 `package.json` 声明运行时依赖和开发依赖
- 使用 `package-lock.json`（lockfileVersion: 3）锁定所有依赖树版本，确保安装可重现性
- 未发现 pnpm-lock.yaml、yarn.lock 或 .npmrc 等替代配置

**依赖分类**
- 运行时依赖（dependencies）：react、react-dom、zustand、electron-store、sql.js、lucide-react
- 开发依赖（devDependencies）：electron、electron-builder、electron-vite、vite、typescript、tailwindcss 等构建工具链

**原生模块处理**
- 通过 `postinstall` 脚本执行 `electron-builder install-app-deps` 自动重建原生模块
- electron-builder 配置中排除 `node_modules/**/*`，仅打包编译后的 `out/` 目录

**发布与打包**
- 使用 electron-builder 进行 Windows NSIS 安装包构建
- 额外资源（data 目录）通过 extraResources 配置嵌入到应用中
- 输出目录为 dist，应用 ID 为 com.gene-engineering.assistant

**无私有仓库配置**
- 未发现 .npmrc、私有 registry 配置或 GOPRIVATE 等自定义源设置
- 所有依赖均从官方 npmjs.org 获取
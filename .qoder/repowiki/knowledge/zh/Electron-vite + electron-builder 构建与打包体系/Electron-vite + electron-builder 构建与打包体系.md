---
kind: build_system
name: Electron-vite + electron-builder 构建与打包体系
category: build_system
scope:
    - '**'
source_files:
    - gene-engineering-tool/package.json
    - gene-engineering-tool/electron.vite.config.ts
    - gene-engineering-tool/electron-builder.json
    - gene-engineering-tool/tsconfig.json
---

本项目采用 Electron-vite 作为开发/构建工具链，electron-builder 负责跨平台桌面安装包生成，整体构建流程围绕 npm scripts 驱动。

1. 构建系统与技术栈
- 构建入口：electron-vite（v2），同时编译 main、preload、renderer 三个进程产物，输出到 out/ 目录。
- 打包器：electron-builder（v25），默认将 out/**/* 打包进应用包，并排除 node_modules，额外把 data/ 资源复制到 app.asar 中的 data 路径。
- 运行时依赖：Electron v33；渲染层使用 Vite + React 插件，CSS 走 PostCSS + Tailwind。
- TypeScript：根 tsconfig.json 通过 project references 引用 tsconfig.node.json 和 tsconfig.web.json，分别对应 Node/Electron main 与浏览器 renderer 两套编译目标。

2. 关键配置文件
- package.json：定义 dev/build/preview/postinstall 脚本；postinstall 自动执行 electron-builder install-app-deps 以安装原生模块。
- electron.vite.config.ts：配置 main/preload/renderer 三端输入、别名（@shared、@）、React 插件、PostCSS 集成及 Rollup input。
- electron-builder.json：声明 appId、productName、输出目录 dist、打包文件规则、extraResources（data）以及 Windows NSIS 目标。
- tsconfig.json / tsconfig.node.json / tsconfig.web.json：统一 ES2020 + bundler 解析策略，strict + isolatedModules 保证类型安全与 vite 兼容。

3. 构建与发布约定
- 本地开发：npm run dev → electron-vite dev 启动主进程与渲染进程热重载。
- 本地预览：npm run preview → 基于已构建产物预览应用。
- 构建产物：npm run build → 产出 out/main/index.js、out/preload/index.js、out/renderer/index.html 等。
- 打包安装包：在 package.json 中未显式暴露打包命令，通常通过 npx electron-builder 或自定义脚本触发，默认输出到 dist/，Windows 下生成 NSIS 安装包。
- 版本管理：版本号集中在 package.json 的 version 字段（当前 0.1.0），electron-builder 会将其注入安装包元数据。

4. 开发者应遵循的规则
- 新增共享类型放在 src/shared，并通过 @shared 别名在主/预加载/渲染三方引用，避免重复定义。
- 新增静态资源需同步更新 electron-builder.json 的 extraResources，确保打包后路径一致。
- 保持 tsconfig.* 的 strict/isolatedModules 开启，新增模块遵循 moduleResolution: bundler 语义。
- 如需扩展多平台打包，在 electron-builder.json 的 win/mac/linux 区块追加 target，不要修改现有 nsis 配置。
- 所有构建相关命令优先通过 npm scripts 调用，避免直接运行 electron-vite/electron-builder CLI。
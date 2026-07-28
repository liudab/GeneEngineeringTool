# HelixCraft 打包配置说明

> 最后更新：2026-07-16 | 当前版本：0.1.0-beta | 目标格式：NSIS (Windows x64)

---

## 一、构建流程概览

```
源码 (src/) → electron-vite build → 编译产物 (out/) → electron-builder → NSIS 安装包 (dist/)
```

| 阶段 | 工具 | 命令 | 说明 |
|------|------|------|------|
| 编译 | electron-vite | `node ./node_modules/electron-vite/bin/electron-vite.js build` | TypeScript → JS，分 main/preload/renderer 三路编译 |
| 打包 | electron-builder | `node ./node_modules/electron-builder/cli.js --win --config electron-builder.json` | 将编译产物 + 依赖打包为 NSIS 安装包 |
| 开发 | electron-vite | `node ./node_modules/electron-vite/bin/electron-vite.js dev` | 热更新开发模式 |

> **Windows 注意**：PowerShell 默认禁止运行 npm 脚本，需绕过 npm 直接用 node 执行构建工具入口。

---

## 二、配置文件详解

### 2.1 `electron-builder.json` — 打包配置

```jsonc
{
  // JSON Schema 声明，提供 IDE 智能提示
  "$schema": "https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/scheme.json",

  // 应用唯一标识符（反向域名格式），用于系统注册表、安装路径等
  "appId": "com.bohanlab.helixcraft",

  // 安装后显示的产品名称（影响开始菜单、桌面快捷方式名称）
  "productName": "HelixCraft",

  // 输出目录配置
  "directories": {
    "output": "dist"  // NSIS 安装包文件输出到项目根目录的 dist/ 文件夹
  },

  // 需要打包进 asar 归档的文件
  "files": [
    "out/**/*",           // electron-vite 编译产物（main + preload + renderer）
    "node_modules/**/*"   // 运行时依赖（sql.js、xlsx 等）
  ],

  // 需要从 asar 中解包的文件（WASM 等需要直接从文件系统加载的二进制）
  "asarUnpack": [
    "node_modules/sql.js/dist/sql-wasm.wasm"  // SQLite WASM 后端必须解包
  ],

  // 额外资源：打包后放在 resources/ 目录下，运行时可通过 process.resourcesPath 访问
  "extraResources": [
    {
      "from": "data",   // 项目根目录的 data/ 文件夹
      "to": "data"      // 打包后位于 resources/data/
    }
  ],

  // Windows 平台特定配置
  "win": {
    "icon": "icon.ico",  // 应用图标（必须 ≥ 256×256 像素）
    "target": [
      {
        "target": "nsis",    // 安装包格式：NSIS（.exe 安装器）
        "arch": ["x64"]      // 目标架构：仅 64 位
      }
    ],
    "signAndEditExecutable": false  // 跳过代码签名（无证书时必需）
  },

  // NSIS 安装器特定配置
  "nsis": {
    "oneClick": false,              // 禁用一键安装，显示安装向导界面
    "perMachine": true,             // 默认安装为所有用户（需要管理员权限）
    "allowElevation": true,         // 允许提权请求管理员权限
    "allowToChangeInstallationDirectory": true,  // 允许用户自定义安装目录
    "runAfterFinish": true,         // 安装完成后提供"立即运行"复选框
    "createDesktopShortcut": true,   // 默认创建桌面快捷方式
    "createStartMenuShortcut": true, // 默认创建开始菜单快捷方式
    "shortcutName": "HelixCraft",   // 快捷方式显示名称
    "installerIcon": "icon.ico",    // 安装程序图标
    "uninstallerIcon": "icon.ico",  // 卸载程序图标
    "installerHeaderIcon": "icon.ico", // 安装向导头部图标
    "unicode": true,                // 启用 Unicode 支持（中文路径必需）
    "language": "2052",             // 简体中文 LCID
    "menuCategory": false,          // 不在开始菜单创建子文件夹
    "displayLanguageSelector": false, // 不显示语言选择界面
    "include": "build/nsis-custom.nsh" // 自定义 NSIS 脚本（内测版提醒）
  }
}
```

### 2.2 `package.json` — 版本与依赖

```jsonc
{
  "name": "helixcraft",
  "version": "0.1.0-beta",  // 版本号：-beta 后缀表示内测版，自动同步到安装包文件名
  "description": "HelixCraft - 基因工程辅助软件",
  "main": "./out/main/index.js",  // Electron 主进程入口

  "scripts": {
    "dev": "electron-vite dev",           // 开发模式（需绕过 PowerShell 执行策略）
    "build": "electron-vite build",       // 编译（不含打包）
    "preview": "electron-vite preview",   // 预览编译产物
    "postinstall": "electron-builder install-app-deps"  // npm install 后自动安装原生依赖
  },

  // 运行时依赖 — 会被打包进安装包
  "dependencies": {
    "electron-store": "^10.0.0",  // 本地配置持久化
    "lucide-react": "^0.460.0",   // 图标库
    "react": "^18.3.1",           // UI 框架
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0", // 路由
    "sql.js": "^1.11.0",          // SQLite（WASM 后端）— 核心数据库引擎
    "xlsx": "^0.18.5",            // Excel 文件导入
    "zustand": "^5.0.0"           // 状态管理
  },

  // 开发依赖 — 不会被打包进安装包
  "devDependencies": {
    "electron": "^33.2.0",         // Electron 运行时
    "electron-builder": "^25.1.8", // 打包工具
    "electron-vite": "^2.3.0",    // 构建工具
    // ... 其他开发工具
  }
}
```

### 2.3 `electron.vite.config.ts` — 编译配置

| 编译目标 | 入口文件 | 输出目录 | 说明 |
|----------|----------|----------|------|
| `main` | `src/main/index.ts` | `out/main/` | Electron 主进程（Node.js 环境） |
| `preload` | `preload/index.ts` | `out/preload/` | 预加载脚本（桥接主进程与渲染进程） |
| `renderer` | `src/renderer/index.html` | `out/renderer/` | React 前端（浏览器环境） |

**关键配置**：
- `externalizeDepsPlugin()`：主进程和预加载脚本的依赖标记为外部（不打包进 bundle，运行时从 node_modules 加载）
- `@shared` 别名：指向 `src/shared/`，主进程和渲染进程共享类型定义和 i18n
- PWA 插件：仅在 Web 模式（非 Electron）下启用，Electron 环境自动禁用 Service Worker

---

## 三、打包产物结构

安装后的目录结构（以默认路径 `C:\Program Files\HelixCraft\` 为例）：

```
HelixCraft/
├── resources/
│   ├── app.asar          # 应用代码归档（out/ + node_modules/）
│   │   ├── out/main/     # 主进程编译产物
│   │   ├── out/preload/  # 预加载脚本
│   │   ├── out/renderer/ # 前端编译产物
│   │   └── node_modules/ # 运行时依赖
│   │       ├── sql.js/   # SQLite WASM（部分文件解包到 app.asar.unpacked/）
│   │       ├── xlsx/     # Excel 解析
│   │       └── ...
│   ├── app.asar.unpacked/
│   │   └── node_modules/sql.js/dist/sql-wasm.wasm  # WASM 文件（从 asar 解包）
│   └── data/             # 额外资源（从项目 data/ 目录复制）
├── HelixCraft.exe        # Electron 主可执行文件
└── *.dll                 # Electron 运行时依赖的 DLL
```

**用户数据目录**（运行时自动创建）：
```
C:\Users\{用户名}\AppData\Roaming\HelixCraft\
├── gene-engineering.db   # SQLite 数据库
├── logs/                 # 运行日志
└── config/               # 用户配置
```

---

## 四、版本号规范

| 版本格式 | 含义 | 安装包文件名示例 |
|----------|------|------------------|
| `0.1.0` | 正式版 | `HelixCraft Setup 0.1.0.exe` |
| `0.1.0-beta` | 内测版 | `HelixCraft Setup 0.1.0-beta.exe` |
| `0.1.0-rc.1` | 候选发布 | `HelixCraft Setup 0.1.0-rc.1.exe` |
| `0.2.0-alpha` | 开发预览 | `HelixCraft Setup 0.2.0-alpha.exe` |

修改版本号：编辑 `package.json` 中的 `version` 字段，安装包文件名自动同步。

---

## 五、常见调整场景

### 5.1 切换安装包格式

```jsonc
// NSIS（.exe 安装器，支持自定义安装界面）
"win": { "target": [{ "target": "nsis", "arch": ["x64"] }] }

// MSI（.msi 安装器，Windows 原生）
"win": { "target": [{ "target": "msi", "arch": ["x64"] }] }

// 便携版（无需安装，解压即用）
"win": { "target": [{ "target": "portable", "arch": ["x64"] }] }
```

### 5.2 添加新的运行时依赖

1. `npm install <package>` — 自动添加到 `dependencies`
2. 如果依赖包含原生模块（.node 文件），需确认 `postinstall` 脚本正确执行
3. 如果依赖包含 WASM/二进制文件，需在 `asarUnpack` 中添加解包规则
4. 重新执行 `build` + 打包命令

### 5.3 添加额外资源文件

```jsonc
"extraResources": [
  { "from": "data", "to": "data" },
  { "from": "templates", "to": "templates" }  // 新增
]
```

运行时通过 `path.join(process.resourcesPath, 'templates')` 访问。

### 5.4 更换应用图标

1. 准备 `icon.ico` 文件（要求 ≥ 256×256 像素，ICO 格式）
2. 放在项目根目录，替换现有 `icon.ico`
3. 重新打包即可

### 5.5 添加代码签名

```jsonc
"win": {
  "signAndEditExecutable": true,  // 改为 true
  "certificateFile": "cert.pfx",
  "certificatePassword": "xxx"    // 或通过环境变量 WIN_CSC_LINK 指定
}
```

### 5.6 支持多架构

```jsonc
"win": {
  "target": [
    { "target": "msi", "arch": ["x64", "arm64"] }
  ]
}
```

将生成两个安装包：`HelixCraft Setup 0.1.0-beta x64.exe` 和 `HelixCraft Setup 0.1.0-beta arm64.exe`。

---

## 六、构建环境变量

| 变量名 | 用途 | 示例 |
|--------|------|------|
| `ELECTRON_BUILDER_BINARIES_MIRROR` | 二进制工具下载镜像（国内加速） | `https://npmmirror.com/mirrors/electron-builder-binaries/` |
| `ELECTRON` | 标记 Electron 环境（PWA 插件据此禁用） | `true` |
| `WIN_CSC_LINK` | 代码签名证书路径 | `./cert.pfx` |

---

## 七、注意事项与踩坑记录

1. **node_modules 必须包含**：`files` 中必须有 `node_modules/**/*`，否则运行时依赖（如 sql.js）缺失导致启动失败
2. **WASM 文件需解包**：sql.js 的 `.wasm` 文件必须通过 `asarUnpack` 解包，否则无法从 asar 归档中加载
3. **PowerShell 执行策略**：Windows PowerShell 默认禁止 npm 脚本，需直接用 node 执行构建工具入口
4. **图标尺寸要求**：NSIS 格式要求图标 ≥ 256×256 像素，ICO 格式
5. **signAndEditExecutable**：无代码签名证书时必须设为 `false`，否则 winCodeSign 解压符号链接时可能因权限不足失败
6. **MSI 不支持高级 UI 选项**：MSI 格式不支持像 NSIS 那样的自定义安装界面（欢迎页文字、侧边栏图片等），已切换为 NSIS 格式
7. **数据目录固定**：用户数据存储在 `AppData/Roaming/HelixCraft/`，不随安装路径变化，确保卸载后数据不丢失
8. **d3dcompiler_47.dll 安装失败问题**：MSI 格式在 Windows 10 上安装 Electron 自带的 `d3dcompiler_47.dll` 时可能报"安装目录无法访问"错误。根因是 MSI 的文件复制机制与 Windows 10 的 DLL 锁定保护存在冲突。**解决方案**：切换到 NSIS 格式，NSIS 对文件复制错误的容错性更好。
9. **MSI vs NSIS 兼容性对比**：MSI 基于 Windows Installer 引擎，对系统文件保护更严格，容易触发权限/锁定冲突；NSIS 直接执行文件复制操作，兼容性更好，且支持更丰富的自定义安装界面（欢迎页文字、侧边栏图片等）。
10. **NSIS 中文本地化**：`"language": "2052"` 对应简体中文 LCID，安装向导所有界面文本自动汉化。
11. **内测版提醒实现方式**：通过 NSIS 自定义脚本（`include` 字段引入 `.nsh` 文件），覆盖 MUI2 欢迎页面和完成页面的标题和正文，添加醒目的内测版警告文字。注意不可在自定义脚本中重复 `!include MUI2.nsh`，因为 electron-builder 已自动包含。
12. **NSIS 侧边栏图片格式**：`installerSidebar`/`uninstallerSidebar` 要求 164×314 的 BMP 图片，如果只提供 ICO 格式可能导致构建警告或回退到默认图片。

---
kind: frontend_style
name: Tailwind CSS + React 原子化样式体系
category: frontend_style
scope:
    - '**'
source_files:
    - gene-engineering-tool/tailwind.config.js
    - gene-engineering-tool/postcss.config.js
    - gene-engineering-tool/src/renderer/index.css
    - gene-engineering-tool/src/renderer/App.tsx
    - gene-engineering-tool/src/renderer/components/PlasmidViewer/PlasmidViewer.tsx
---

本项目采用 Tailwind CSS 作为前端样式核心方案，结合 PostCSS 与 Autoprefixer 构建，在 Electron-vite 渲染进程中提供一致的桌面应用视觉风格。

## 样式架构
- 框架与工具链：Tailwind CSS + PostCSS + Autoprefixer，通过 postcss.config.js 启用；Tailwind 扫描路径限定为 ./src/renderer/**/*.{ts,tsx,html}，确保仅对渲染进程生效。
- 设计令牌（Design Tokens）：在 tailwind.config.js 的 theme.extend.colors 中集中定义 primary 色板（50–900）用于主色调，accent.dna/enzyme/vector/gene 四色分别映射到基因工程领域实体（DNA、限制性内切酶、载体、基因），形成领域语义化的色彩约定。
- 全局样式入口：src/renderer/index.css 使用 @tailwind base/components/utilities 注入基础层，并通过 :root 变量 --sidebar-width 暴露布局尺寸，同时自定义滚动条、序列显示等全局规则。

## 组件级样式策略
- 原子类优先：页面与组件广泛直接使用 Tailwind 原子类（如 flex、bg-slate-900、text-sm font-bold fill-slate-700、rounded-lg、focus:ring-blue-500），避免手写 CSS 类名。
- SVG 可视化样式：PlasmidViewer.tsx 将特征颜色硬编码为 FEATURE_COLORS 映射表，与 accent.* 领域色保持语义一致；文本样式统一使用 fill-* + text-[*px] 原子类。
- 序列着色：index.css 中的 .sequence-display .nucleotide-{A/T/G/C} 类以固定色值区分碱基，与 DNA 主题色呼应。

## 布局与响应式约定
- 整体采用 flex 布局：侧边栏（w-16/w-56 可折叠）、顶部 header（h-14）、主内容区（flex-1 overflow-auto p-6）。
- 未引入断点媒体查询，依赖弹性容器与百分比宽度实现自适应。

## 开发者规范
1. 新增 UI 元素优先使用 Tailwind 原子类，不要新建独立 CSS 文件。
2. 颜色必须从 tailwind.config.js 的 primary / accent.* 取值，禁止在组件中硬编码十六进制色值。
3. 字体统一使用系统栈 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei'，代码/序列区域使用 monospace。
4. SVG 图表的颜色映射应集中在组件内部常量或配置对象中，保持与领域语义对应。
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initLanguage } from '../shared/i18n'
import './index.css'

// 初始化语言
try {
  const stored = localStorage.getItem('appLanguage') as 'zh' | 'en' | null
  initLanguage(stored || 'zh')
} catch {
  initLanguage('zh')
}

// 所有路由（主窗口 / 编辑器窗口 / 基因编辑器窗口）统一由 App 组件处理
// App 内部通过 getEditorMode() 检测 URL 参数，分发到对应页面
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

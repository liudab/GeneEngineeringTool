import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import VectorEditorPage from './pages/VectorEditorPage'
import { initLanguage } from '../shared/i18n'
import './index.css'

// 初始化语言
try {
  const stored = localStorage.getItem('appLanguage') as 'zh' | 'en' | null
  initLanguage(stored || 'zh')
} catch {
  initLanguage('zh')
}

// 检查 URL 参数决定渲染哪个页面
const params = new URLSearchParams(window.location.search)
const mode = params.get('mode')
const vectorId = params.get('vectorId')

if (mode === 'editor' && vectorId) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <VectorEditorPage vectorId={parseInt(vectorId)} />
    </React.StrictMode>
  )
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

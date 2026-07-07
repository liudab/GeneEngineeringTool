import zh from './zh.json'
import en from './en.json'

export type Language = 'zh' | 'en'

const translations: Record<Language, Record<string, string>> = { zh: zh as Record<string, string>, en: en as Record<string, string> }

let currentLang: Language = 'zh'
const listeners: Array<(lang: Language) => void> = []

/** Get current language */
export function getLanguage(): Language {
  return currentLang
}

/** Initialize language (call once at startup) */
export function initLanguage(stored?: Language): void {
  if (stored === 'zh' || stored === 'en') {
    currentLang = stored
  }
}

/** Switch language and notify listeners */
export function setLanguage(lang: Language): void {
  if (lang === currentLang) return
  currentLang = lang
  listeners.forEach(cb => cb(lang))
}

/** Subscribe to language changes */
export function onLanguageChange(cb: (lang: Language) => void): () => void {
  listeners.push(cb)
  return () => {
    const idx = listeners.indexOf(cb)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

/** Translate a key */
export function t(key: string): string {
  return translations[currentLang]?.[key] ?? translations.zh[key] ?? key
}

/** Get feature type translated name */
export function getFeatureTypeName(type: string): string {
  const key = `featureType.${type}` as string
  const translated = t(key)
  return translated === key ? type : translated
}

/** Feature type name with code, e.g. "基因 (gene)" */
export function featureTypeLabel(type: string): string {
  const name = getFeatureTypeName(type)
  return name === type ? type : `${name} (${type})`
}

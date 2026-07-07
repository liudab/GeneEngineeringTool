import { useState, useEffect, useCallback } from 'react'
import { t, getLanguage, setLanguage, onLanguageChange, getFeatureTypeName, featureTypeLabel } from '../../shared/i18n'
import type { Language } from '../../shared/i18n'

/** React hook for i18n. Re-renders component on language change. */
export function useI18n() {
  const [, setTick] = useState(0)

  useEffect(() => {
    return onLanguageChange(() => setTick(t => t + 1))
  }, [])

  const changeLanguage = useCallback((lang: Language) => {
    setLanguage(lang)
    try { localStorage.setItem('appLanguage', lang) } catch {}
    // Notify main process to rebuild menu
    if ((window as any).api?.setMenuLanguage) {
      (window as any).api.setMenuLanguage(lang)
    }
  }, [])

  return { t, language: getLanguage(), changeLanguage, getFeatureTypeName, featureTypeLabel }
}

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en/common.json'
import es from './locales/es/common.json'
import de from './locales/de/common.json'
import fr from './locales/fr/common.json'
import it from './locales/it/common.json'
import { loadPreferences } from './preferences/preferences'

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    es: { common: es },
    de: { common: de },
    fr: { common: fr },
    it: { common: it },
  },
  lng: loadPreferences().language,
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

export default i18n

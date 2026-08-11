import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ca from './locales/ca/common.json'
import de from './locales/de/common.json'
import en from './locales/en/common.json'
import es from './locales/es/common.json'
import eu from './locales/eu/common.json'
import fr from './locales/fr/common.json'
import gl from './locales/gl/common.json'
import it from './locales/it/common.json'
import { loadPreferences } from './preferences/preferences'

void i18n.use(initReactI18next).init({
  resources: {
    ca: { common: ca },
    de: { common: de },
    en: { common: en },
    es: { common: es },
    eu: { common: eu },
    fr: { common: fr },
    gl: { common: gl },
    it: { common: it },
  },
  lng: loadPreferences().language,
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

export default i18n

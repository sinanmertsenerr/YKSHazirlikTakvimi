import i18n from 'i18next';
import { getLocales } from 'expo-localization';
import { initReactI18next } from 'react-i18next';

import { resources } from './resources';

const deviceLanguage = getLocales()[0]?.languageCode === 'en' ? 'en' : 'tr';

// eslint-disable-next-line import/no-named-as-default-member
void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage,
  fallbackLng: 'tr',
  supportedLngs: ['tr', 'en'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function resolveLanguage(preference: 'system' | 'tr' | 'en') {
  if (preference !== 'system') return preference;
  return getLocales()[0]?.languageCode === 'en' ? 'en' : 'tr';
}

export default i18n;

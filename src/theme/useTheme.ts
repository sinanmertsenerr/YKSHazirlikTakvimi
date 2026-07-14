import { useColorScheme } from 'react-native';

import { useSettingsStore } from '@/stores/settings';

import { darkColors, lightColors, radii, spacing, typography } from './tokens';

export function useTheme() {
  const systemScheme = useColorScheme();
  const selectedTheme = useSettingsStore((state) => state.theme);
  const scheme = selectedTheme === 'system' ? (systemScheme ?? 'light') : selectedTheme;

  return {
    colors: scheme === 'dark' ? darkColors : lightColors,
    dark: scheme === 'dark',
    scheme,
    spacing,
    radii,
    typography,
  } as const;
}

export type AppTheme = ReturnType<typeof useTheme>;

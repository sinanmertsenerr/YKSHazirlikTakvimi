import { Stack } from 'expo-router';

import { useTheme } from '@/theme/useTheme';

export default function NewsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}

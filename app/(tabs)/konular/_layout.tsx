import { Stack } from 'expo-router';

import { useTheme } from '@/theme/useTheme';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function TopicsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      {/* Keep edge swipe-back but shrink its trigger zone to the far-left edge, so dragging the
          horizontal % slider (inset ~34px from the edge) isn't misread as a back gesture. */}
      <Stack.Screen name="konu/[konuId]" options={{ gestureResponseDistance: { start: 20 } }} />
    </Stack>
  );
}

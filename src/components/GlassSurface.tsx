import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { PropsWithChildren, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { useTheme } from '@/theme/useTheme';

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
  accessibilityLabel?: string;
}>;

export function GlassSurface({ children, style, interactive, accessibilityLabel }: Props) {
  const { colors, dark } = useTheme();
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    return () => subscription.remove();
  }, []);

  const common = [styles.surface, { borderColor: colors.glassBorder }, style];
  const canUseGlass =
    Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

  if (reduceTransparency) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={[common, { backgroundColor: colors.surface }]}
      >
        {children}
      </View>
    );
  }

  if (canUseGlass) {
    return (
      <GlassView
        accessibilityLabel={accessibilityLabel}
        colorScheme={dark ? 'dark' : 'light'}
        glassEffectStyle="regular"
        isInteractive={interactive}
        style={common}
        tintColor={colors.glass}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <BlurView
      accessibilityLabel={accessibilityLabel}
      blurMethod="dimezisBlurViewSdk31Plus"
      intensity={Platform.OS === 'android' ? 18 : 42}
      style={[common, { backgroundColor: colors.glass }]}
      tint={dark ? 'dark' : 'light'}
    >
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});

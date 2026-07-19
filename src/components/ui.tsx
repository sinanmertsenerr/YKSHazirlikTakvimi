import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ReactNode, useRef } from 'react';
import {
  AccessibilityRole,
  GestureResponderEvent,
  Pressable,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/theme/useTheme';

import { GlassSurface } from './GlassSurface';

export function Screen({
  children,
  contentContainerStyle,
  ...props
}: ScrollViewProps & { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        {...props}
        contentContainerStyle={[styles.screenContent, contentContainerStyle]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ScreenView({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: colors.background }, style]}
    >
      {children}
    </SafeAreaView>
  );
}

export function AppHeader({
  title,
  subtitle,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
}) {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.headerWrap}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          {back ? (
            <Pressable
              accessibilityLabel={t('common.back')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <MaterialIcons color={colors.brand} name="arrow-back-ios-new" size={20} />
            </Pressable>
          ) : null}
          <Text
            accessibilityRole="header"
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            numberOfLines={2}
            style={[typography.largeTitle, styles.headerTitle, { color: colors.label }]}
          >
            {title}
          </Text>
        </View>
        {right ??
          (!back ? (
            <IconButton
              accessibilityLabel={t('common.settings')}
              icon="settings"
              onPress={() => router.push('/ayarlar')}
            />
          ) : null)}
      </View>
      {subtitle ? (
        <Text
          numberOfLines={2}
          style={[typography.subhead, { color: colors.secondaryLabel, marginTop: 2 }]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function Card({
  children,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors, radii } = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, { backgroundColor: colors.surface, borderRadius: radii.card }, style]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.sectionTitleRow}>
      <Text
        numberOfLines={2}
        style={[typography.headline, { color: colors.label, flex: 1, minWidth: 0 }]}
      >
        {children}
      </Text>
      {action}
    </View>
  );
}

export function Caption({ children, color }: { children: ReactNode; color?: string }) {
  const { colors, typography } = useTheme();
  return (
    <Text style={[typography.caption, styles.caption, { color: color ?? colors.secondaryLabel }]}>
      {children}
    </Text>
  );
}

export function Footnote({ children, color }: { children: ReactNode; color?: string }) {
  const { colors, typography } = useTheme();
  return (
    <Text style={[typography.footnote, { color: color ?? colors.secondaryLabel }]}>{children}</Text>
  );
}

export function Chip({
  children,
  color,
  backgroundColor,
  onPress,
  selected,
  accessibilityLabel,
}: {
  children: ReactNode;
  color?: string;
  backgroundColor?: string;
  onPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const content = (
    <Text numberOfLines={1} style={[styles.chipText, { color: color ?? colors.label }]}>
      {children}
    </Text>
  );
  const chipStyle = [
    styles.chip,
    { backgroundColor: backgroundColor ?? colors.surfaceSecondary },
    selected && { borderColor: color ?? colors.brand, borderWidth: 1 },
  ];
  if (!onPress) return <View style={chipStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [chipStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}) {
  const { colors, radii } = useTheme();
  return (
    <GlassSurface
      accessibilityLabel={accessibilityLabel}
      style={[styles.segment, { borderRadius: radii.button }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => {
              // Haptics are optional feedback; unsupported devices must never surface a
              // technical promise rejection or block the actual selection.
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(option.value);
            }}
            style={[
              styles.segmentOption,
              selected && {
                backgroundColor: colors.surface,
                borderColor: colors.separator,
                borderRadius: 9,
              },
            ]}
          >
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              numberOfLines={2}
              style={[
                styles.segmentText,
                { color: selected ? colors.label : colors.secondaryLabel },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </GlassSurface>
  );
}

export function ProgressRing({
  progress,
  color,
  labelColor = color,
  size = 48,
}: {
  progress: number;
  color: string;
  labelColor?: string;
  size?: number;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = Math.PI * 2 * radius;
  const safeProgress = Math.max(0, Math.min(1, progress));
  const percent = Math.round(safeProgress * 100);
  return (
    <View
      accessible
      accessibilityLabel={t('common.completedPercent', { percent })}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.progressRing, { width: size, height: size }]}
    >
      <Svg height={size} style={{ transform: [{ rotate: '-90deg' }] }} width={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke={colors.surfaceSecondary}
          strokeWidth={stroke}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke={color}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - safeProgress)}
          strokeLinecap="round"
          strokeWidth={stroke}
        />
      </Svg>
      <Text
        accessible={false}
        adjustsFontSizeToFit
        numberOfLines={1}
        pointerEvents="none"
        style={[styles.progressRingLabel, { color: labelColor }]}
      >
        %{percent}
      </Text>
    </View>
  );
}

export function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      style={[styles.progressTrack, { backgroundColor: colors.surfaceSecondary }]}
    >
      <View
        style={[
          styles.progressFill,
          { backgroundColor: color, width: `${Math.max(0, Math.min(1, progress)) * 100}%` },
        ]}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: keyof typeof MaterialIcons.glyphMap;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radii } = useTheme();
  const background =
    variant === 'primary'
      ? colors.brand
      : variant === 'danger'
        ? colors.danger
        : colors.surfaceSecondary;
  const foreground = variant === 'secondary' ? colors.label : colors.onBrand;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        // The button action remains authoritative when haptics are unavailable.
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderRadius: radii.button },
        pressed && styles.pressed,
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {icon ? <MaterialIcons color={foreground} name={icon} size={20} /> : null}
      <Text numberOfLines={1} style={[styles.buttonText, { color: foreground }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color,
  selected,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  color?: string;
  selected?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <MaterialIcons color={color ?? colors.secondaryLabel} name={icon} size={24} />
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  body: string;
  action?: { title: string; onPress: () => void };
}) {
  const { colors, typography } = useTheme();
  return (
    <Card style={styles.emptyCard}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.brandSoft }]}>
        <MaterialIcons color={colors.brand} name={icon} size={34} />
      </View>
      <Text style={[typography.headline, { color: colors.label, textAlign: 'center' }]}>
        {title}
      </Text>
      <Text style={[typography.footnote, { color: colors.secondaryLabel, textAlign: 'center' }]}>
        {body}
      </Text>
      {action ? <Button onPress={action.onPress} title={action.title} /> : null}
    </Card>
  );
}

export function Field({
  label,
  labelHidden,
  error,
  containerStyle,
  style,
  ...props
}: TextInputProps & {
  label: string;
  // Hide the visible label (it stays as accessibilityLabel and placeholder fallback).
  labelHidden?: boolean;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const { colors, radii, typography } = useTheme();
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      {labelHidden ? null : (
        <Text style={[typography.footnote, styles.fieldLabel, { color: colors.secondaryLabel }]}>
          {label}
        </Text>
      )}
      <TextInput
        accessibilityLabel={label}
        placeholder={labelHidden ? label : undefined}
        placeholderTextColor={colors.secondaryLabel}
        {...props}
        style={[
          styles.field,
          typography.body,
          {
            color: colors.label,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.separator,
            borderRadius: radii.button,
          },
          style,
        ]}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.footnote, { color: colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.statCard}>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.statValue, { color: color ?? colors.label }]}
      >
        {value}
      </Text>
      <Text numberOfLines={2} style={[styles.statLabel, { color: colors.secondaryLabel }]}>
        {label}
      </Text>
    </Card>
  );
}

export function RowButton({
  children,
  onPress,
  accessibilityLabel,
  role = 'button',
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
  role?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={role}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

// Draggable 0–100 progress bar snapped to 5% steps (20 segments). Drag or tap to set; the
// derived status (0 = not started, 1–99 = working, 100 = done) lives with the caller.
export function PercentSlider({
  value,
  onChange,
  onInteractStart,
  onInteractEnd,
}: {
  value: number;
  onChange: (value: number) => void;
  // Fired on touch-down / release so the caller can e.g. suspend the screen's swipe-back
  // gesture only while the bar is being dragged, instead of disabling it screen-wide.
  // onInteractEnd also fires after each accessibility increment/decrement (without a
  // matching onInteractStart) — it is the "value settled, safe to persist" signal.
  onInteractStart?: () => void;
  onInteractEnd?: () => void;
}) {
  const { colors } = useTheme();
  const widthRef = useRef(0);
  // widthRef is read only here, inside the touch handler — never during render.
  const handleTouch = (event: GestureResponderEvent) => {
    const trackWidth = widthRef.current;
    if (trackWidth <= 0) return;
    const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth));
    const next = Math.round((ratio * 100) / 5) * 5;
    if (next !== value) onChange(next);
  };
  const handleGrant = (event: GestureResponderEvent) => {
    onInteractStart?.();
    handleTouch(event);
  };

  return (
    <View
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      accessibilityRole="adjustable"
      accessibilityValue={{ max: 100, min: 0, now: value }}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') onChange(Math.min(100, value + 5));
        else if (event.nativeEvent.actionName === 'decrement') onChange(Math.max(0, value - 5));
        else return;
        onInteractEnd?.();
      }}
      onLayout={(event) => {
        widthRef.current = event.nativeEvent.layout.width;
      }}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handleGrant}
      onResponderMove={handleTouch}
      onResponderRelease={() => onInteractEnd?.()}
      onResponderTerminate={() => onInteractEnd?.()}
      // Keep the drag once it starts so a JS parent can't hijack the gesture mid-drag.
      onResponderTerminationRequest={() => false}
      onStartShouldSetResponder={() => true}
      style={styles.sliderTouch}
    >
      <View
        pointerEvents="none"
        style={[styles.sliderTrack, { backgroundColor: colors.surfaceSecondary }]}
      >
        <View style={[styles.sliderFill, { width: `${value}%`, backgroundColor: colors.brand }]} />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.sliderThumb,
          { left: `${value}%`, backgroundColor: colors.brand, borderColor: colors.surface },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  progressRing: { alignItems: 'center', justifyContent: 'center' },
  progressRingLabel: {
    position: 'absolute',
    maxWidth: '72%',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  sliderTouch: { height: 40, justifyContent: 'center' },
  sliderTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  sliderFill: { height: 8, borderRadius: 4 },
  sliderThumb: {
    position: 'absolute',
    top: '50%',
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    borderRadius: 13,
    borderWidth: 3,
  },
  // NativeTabs floats above the scene on iOS and can minimize while scrolling. Keep the final
  // action/content fully reachable instead of letting it settle underneath the tab bar.
  screenContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 132 },
  headerWrap: { marginBottom: 14 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  headerTitle: { flex: 1, minWidth: 0 },
  backButton: { width: 36, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  card: {
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  caption: { textTransform: 'uppercase', letterSpacing: 0.55 },
  chip: {
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  chipText: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  segment: { flexDirection: 'row', padding: 3, minHeight: 48, marginBottom: 14 },
  segmentOption: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentText: { fontSize: 13, lineHeight: 17, fontWeight: '700', textAlign: 'center' },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  button: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonText: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  pressed: { opacity: 0.66, transform: [{ scale: 0.99 }] },
  emptyCard: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  fieldWrap: { gap: 6, marginBottom: 14 },
  fieldLabel: { fontWeight: '600' },
  field: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 },
  statCard: {
    flex: 1,
    minWidth: 0,
    marginBottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  statLabel: { fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 2 },
});

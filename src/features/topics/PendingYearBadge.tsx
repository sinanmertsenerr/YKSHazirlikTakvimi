import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme/useTheme';

// Single source for the "MEB hasn't published year X yet" badge, so the subject list and
// the topic detail render the exact same affordance. `style` is for layout-only tweaks
// (maxWidth in the list row, flex in the detail chips row) — visuals stay unified here.
export function PendingYearBadge({
  year,
  style,
}: {
  year: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: colors.warningSoft }, style]}>
      <MaterialIcons color={colors.warningText} name="schedule" size={13} />
      <Text
        numberOfLines={2}
        style={[typography.caption, styles.text, { color: colors.warningText }]}
      >
        {t('topics.awaitingYear', { year })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  text: { flexShrink: 1 },
});

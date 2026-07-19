import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui';
import { totalExamNet } from '@/features/progress/calculations';
import { useTheme } from '@/theme/useTheme';
import { formatNumber, relativeTime } from '@/utils/format';

import type { RecentActivity } from './recentActivity';

export function RecentActivityCard({
  activity,
  language,
}: {
  activity: RecentActivity;
  language: 'tr' | 'en';
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radii, typography } = useTheme();
  const time = activity.kind === 'empty' ? null : relativeTime(activity.createdAt, language);

  let title: string;
  let subtitle: string;
  let icon: keyof typeof MaterialIcons.glyphMap;
  let accessibilityLabel: string;
  let onPress: (() => void) | null = null;

  if (activity.kind === 'topic') {
    const subjectName = activity.subject.name[language];
    const topicName = activity.topic.name[language];
    const progressLabel = t('common.completedPercent', { percent: activity.progress.percent });
    title = topicName;
    subtitle = `${subjectName} · ${progressLabel}`;
    icon = 'menu-book';
    accessibilityLabel = `${t('home.recentActivity')}, ${topicName}, ${subjectName}, ${progressLabel}`;
    onPress = () =>
      router.push({
        pathname: '/konular/konu/[konuId]',
        params: { konuId: activity.topic.id, dersId: activity.subject.id },
      });
  } else if (activity.kind === 'exam') {
    const examLabel = t('home.examActivity', { exam: activity.exam.exam.toUpperCase() });
    const netLabel = `${formatNumber(totalExamNet(activity.exam), language)} ${t('common.net')}`;
    title = activity.exam.publisher || examLabel;
    subtitle = activity.exam.publisher ? `${examLabel} · ${netLabel}` : netLabel;
    icon = 'assessment';
    accessibilityLabel = `${t('home.recentActivity')}, ${title}, ${subtitle}`;
    onPress = () => router.push(`/gelisim/deneme/${activity.exam.id}`);
  } else if (activity.kind === 'empty') {
    title = t('home.noRecentActivity');
    subtitle = t('home.noRecentActivityBody');
    icon = 'history';
    accessibilityLabel = `${title}. ${subtitle}. ${t('home.browseTopics')}`;
    onPress = () => router.push('/konular');
  } else {
    title = t('home.activityUnavailable');
    subtitle = '';
    icon = 'history';
    accessibilityLabel = `${t('home.recentActivity')}, ${title}`;
  }

  const card = (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={[typography.caption, styles.eyebrow, { color: colors.secondaryLabel }]}>
          {t('home.recentActivity')}
        </Text>
        {time ? (
          <Text numberOfLines={1} style={[typography.footnote, { color: colors.secondaryLabel }]}>
            {time}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>
        <View
          style={[styles.icon, { backgroundColor: colors.brandSoft, borderRadius: radii.button }]}
        >
          <MaterialIcons color={colors.brand} name={icon} size={24} />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={2} style={[typography.headline, { color: colors.label }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={2} style={[typography.footnote, { color: colors.secondaryLabel }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {onPress ? (
          <MaterialIcons color={colors.tertiaryLabel} name="chevron-right" size={24} />
        ) : null}
      </View>
    </Card>
  );

  return onPress ? (
    <Pressable
      accessibilityHint={t('home.openActivityHint')}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {card}
    </Pressable>
  ) : (
    <View accessibilityLabel={accessibilityLabel}>{card}</View>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 116 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 0.55 },
  body: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  pressed: { opacity: 0.72 },
});

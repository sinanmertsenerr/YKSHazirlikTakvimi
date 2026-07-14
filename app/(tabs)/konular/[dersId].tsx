import { MaterialIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Card, Chip, EmptyState, ScreenView, SegmentedControl } from '@/components/ui';
import { findSubject, useContentRevisionStore } from '@/data/content';
import {
  getComparableFrequency,
  getComparableVerifiedYears,
  getVerifiedTopicStats,
} from '@/features/topics/statistics';
import { useAppData } from '@/providers/AppDataProvider';
import { useTheme } from '@/theme/useTheme';

type Sort = 'curriculum' | 'frequent' | 'incomplete';

export default function SubjectScreen() {
  const { dersId } = useLocalSearchParams<{ dersId: string }>();
  useContentRevisionStore((state) => state.revision);
  const subject = findSubject(dersId);
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const { progress } = useAppData();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('curriculum');
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const comparableYears = useMemo(
    () => getComparableVerifiedYears(subject?.topics ?? []),
    [subject],
  );
  const canSortByFrequency = comparableYears.length > 0;
  const effectiveSort: Sort = sort === 'frequent' && !canSortByFrequency ? 'curriculum' : sort;

  const topics = useMemo(() => {
    if (!subject) return [];
    const indexed = subject.topics.map((topic, index) => ({ topic, index }));
    indexed.sort((left, right) => {
      if (effectiveSort === 'frequent') {
        const leftFrequency = getComparableFrequency(left.topic, comparableYears);
        const rightFrequency = getComparableFrequency(right.topic, comparableYears);
        if (leftFrequency !== null && rightFrequency !== null) {
          return rightFrequency - leftFrequency || left.index - right.index;
        }
      }
      if (effectiveSort === 'incomplete') {
        const leftDone =
          progress.find((item) => item.topicId === `${subject.id}:${left.topic.id}`)?.status ===
          'done';
        const rightDone =
          progress.find((item) => item.topicId === `${subject.id}:${right.topic.id}`)?.status ===
          'done';
        return Number(leftDone) - Number(rightDone) || left.index - right.index;
      }
      return left.index - right.index;
    });
    return indexed.map((item) => item.topic);
  }, [comparableYears, effectiveSort, progress, subject]);

  if (!subject) {
    return (
      <ScreenView style={styles.missing}>
        <EmptyState body={t('common.subjectNotFound')} icon="menu-book" title={t('topics.title')} />
      </ScreenView>
    );
  }

  return (
    <ScreenView>
      <FlashList
        contentContainerStyle={styles.listContent}
        data={topics}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <AppHeader
              back
              title={subject.name[language]}
              subtitle={t('topics.topicCount', { count: subject.topics.length })}
            />
            <SegmentedControl
              accessibilityLabel={t('topics.sort')}
              onChange={setSort}
              options={[
                { label: t('topics.curriculum'), value: 'curriculum' },
                ...(canSortByFrequency
                  ? [{ label: t('topics.frequent'), value: 'frequent' as const }]
                  : []),
                { label: t('topics.incomplete'), value: 'incomplete' },
              ]}
              value={effectiveSort}
            />
          </View>
        }
        renderItem={({ item }) => {
          const itemProgress = progress.find(
            (record) => record.topicId === `${subject.id}:${item.id}`,
          );
          const verifiedStats = getVerifiedTopicStats(item.yearlyStats);
          const recentStats = verifiedStats.slice(-5);
          const lastStat = recentStats.at(-1);
          const statusColor =
            itemProgress?.status === 'done'
              ? colors.success
              : itemProgress?.status === 'working'
                ? colors.warning
                : colors.tertiaryLabel;
          const max = Math.max(1, ...recentStats.map((stat) => stat.count));
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/konular/konu/[konuId]',
                  params: { konuId: item.id, dersId: subject.id },
                })
              }
            >
              <Card>
                <View style={styles.row}>
                  <View
                    accessibilityLabel={itemProgress?.status ?? t('topics.none')}
                    style={[styles.status, { backgroundColor: statusColor }]}
                  />
                  <View style={styles.grow}>
                    <Text style={[typography.headline, { color: colors.label }]}>
                      {item.name[language]}
                    </Text>
                    {recentStats.length ? (
                      <View
                        accessible
                        accessibilityLabel={t('topics.lastFiveTrend')}
                        style={styles.sparkline}
                      >
                        {recentStats.map((stat) => (
                          <View
                            key={stat.year}
                            style={[
                              styles.spark,
                              {
                                backgroundColor: colors.brand,
                                height: 3 + (stat.count / max) * 13,
                              },
                            ]}
                          />
                        ))}
                      </View>
                    ) : (
                      <Text style={[typography.caption, { color: colors.secondaryLabel }]}>
                        {t('topics.unknownCount')}
                      </Text>
                    )}
                  </View>
                  {lastStat ? (
                    <Chip backgroundColor={colors.brandSoft} color={colors.brand}>
                      {lastStat.year}: {lastStat.count}
                    </Chip>
                  ) : null}
                  <MaterialIcons color={colors.tertiaryLabel} name="chevron-right" size={24} />
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 132 },
  missing: { padding: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0, gap: 6 },
  status: { width: 10, height: 10, borderRadius: 5 },
  sparkline: { height: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  spark: { width: 5, borderRadius: 2 },
});

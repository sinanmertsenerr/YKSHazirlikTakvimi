import { MaterialIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Card, Footnote, ScreenView, SegmentedControl } from '@/components/ui';
import {
  findSubject,
  officialStatsForSubject,
  topicGroupStatisticsPack,
  useContentRevisionStore,
} from '@/data/content';
import {
  getComparableFrequency,
  getComparableVerifiedYears,
  getVerifiedTopicStats,
} from '@/features/topics/statistics';
import { PendingYearBadge } from '@/features/topics/PendingYearBadge';
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
  const progressByTopicId = useMemo(
    () => new Map(progress.map((item) => [item.topicId, item] as const)),
    [progress],
  );
  const comparableYears = useMemo(
    () => getComparableVerifiedYears(subject?.topics ?? []),
    [subject],
  );
  const canSortByFrequency = comparableYears.length > 0;
  const effectiveSort: Sort = sort === 'frequent' && !canSortByFrequency ? 'curriculum' : sort;
  const officialStats = subject ? officialStatsForSubject(subject.id) : undefined;
  const studyTargetYear = subject?.topics[0]?.yearlyStats.at(-1)?.year;
  const studyPendingYear =
    officialStats &&
    topicGroupStatisticsPack.availability === 'available' &&
    studyTargetYear &&
    studyTargetYear > topicGroupStatisticsPack.coverage.lastYear
      ? studyTargetYear
      : null;

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
        const leftDone = progressByTopicId.get(`${subject.id}:${left.topic.id}`)?.status === 'done';
        const rightDone =
          progressByTopicId.get(`${subject.id}:${right.topic.id}`)?.status === 'done';
        return Number(leftDone) - Number(rightDone) || left.index - right.index;
      }
      return left.index - right.index;
    });
    return indexed.map((item) => item.topic);
  }, [comparableYears, effectiveSort, progressByTopicId, subject]);

  if (!subject) {
    return <Redirect href="/konular" />;
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
              right={
                studyPendingYear ? (
                  <PendingYearBadge style={styles.pendingBadge} year={studyPendingYear} />
                ) : undefined
              }
              title={subject.name[language]}
              subtitle={t('topics.topicCount', { count: subject.topics.length })}
            />
            {subject.id.startsWith('ydt') ? (
              <Card style={[styles.officialNotice, { borderLeftColor: colors.warning }]}>
                <Footnote color={colors.warningText}>{t('topics.ydtEnglishOnlyNotice')}</Footnote>
              </Card>
            ) : null}
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
          const itemProgress = progressByTopicId.get(`${subject.id}:${item.id}`);
          const verifiedStats = getVerifiedTopicStats(item.yearlyStats);
          const officialStat = verifiedStats.length
            ? undefined
            : officialStats?.byTopic.get(item.id);
          // Total across every covered year — matches the topic detail chart exactly. Slicing to
          // the last 5 years hid early questions (a lone 2018 question read as 0 on the card).
          const yearlyStats = verifiedStats.length ? verifiedStats : (officialStat?.yearly ?? []);
          const totalCount = yearlyStats.reduce((sum, stat) => sum + stat.count, 0);
          const statusColor =
            itemProgress?.status === 'done'
              ? colors.success
              : itemProgress?.status === 'working'
                ? colors.warning
                : colors.tertiaryLabel;
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
                    {officialStat ? (
                      <Text style={[typography.caption, { color: colors.secondaryLabel }]}>
                        {t('topics.officialCountsSource')}
                      </Text>
                    ) : null}
                  </View>
                  {yearlyStats.length ? (
                    <View
                      accessibilityLabel={`${totalCount} ${t('common.questions')}`}
                      style={[styles.countBadge, { backgroundColor: colors.brand }]}
                    >
                      <Text style={[styles.countText, { color: colors.onBrand }]}>
                        {totalCount}
                      </Text>
                    </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0, gap: 3 },
  status: { width: 10, height: 10, borderRadius: 5 },
  countBadge: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 14, fontWeight: '800' },
  officialNotice: { borderLeftWidth: 3 },
  pendingBadge: { maxWidth: 160 },
});

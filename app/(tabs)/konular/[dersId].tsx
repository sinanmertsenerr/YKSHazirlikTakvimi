import { MaterialIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AppHeader,
  Card,
  Chip,
  EmptyState,
  Footnote,
  Screen,
  ScreenView,
  SectionTitle,
  SegmentedControl,
} from '@/components/ui';
import {
  findSubject,
  officialStatsForSubject,
  officialTopicGroupsForSubject,
  topicGroupStatisticsPack,
  useContentRevisionStore,
} from '@/data/content';
import {
  getComparableFrequency,
  getComparableVerifiedYears,
  getVerifiedTopicStats,
} from '@/features/topics/statistics';
import { useAppData } from '@/providers/AppDataProvider';
import { useTheme } from '@/theme/useTheme';

type Sort = 'curriculum' | 'frequent' | 'incomplete';
type ViewMode = 'study' | 'official';

export default function SubjectScreen() {
  const { dersId } = useLocalSearchParams<{ dersId: string }>();
  useContentRevisionStore((state) => state.revision);
  const subject = findSubject(dersId);
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const { progress } = useAppData();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('curriculum');
  const [viewMode, setViewMode] = useState<ViewMode>('study');
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const comparableYears = useMemo(
    () => getComparableVerifiedYears(subject?.topics ?? []),
    [subject],
  );
  const canSortByFrequency = comparableYears.length > 0;
  const effectiveSort: Sort = sort === 'frequent' && !canSortByFrequency ? 'curriculum' : sort;
  const officialGroups = subject ? officialTopicGroupsForSubject(subject.id) : [];
  const officialStats = subject ? officialStatsForSubject(subject.id) : undefined;

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

  const modeControl = (
    <SegmentedControl
      accessibilityLabel={t('topics.title')}
      onChange={setViewMode}
      options={[
        { label: t('topics.studyTopics'), value: 'study' },
        { label: t('topics.officialGroups'), value: 'official' },
      ]}
      value={viewMode}
    />
  );

  if (viewMode === 'official') {
    const targetYear = subject.topics[0]?.yearlyStats.at(-1)?.year;
    return (
      <Screen>
        <AppHeader
          back
          title={subject.name[language]}
          subtitle={t('topics.officialGroupsSubtitle')}
        />
        {modeControl}
        {subject.id.startsWith('ydt') ? (
          <Card style={[styles.officialNotice, { borderLeftColor: colors.warning }]}>
            <Footnote color={colors.warningText}>{t('topics.ydtEnglishOnlyNotice')}</Footnote>
          </Card>
        ) : null}
        <Card style={[styles.officialNotice, { borderLeftColor: colors.brand }]}>
          <Footnote>{t('topics.officialGroupsNotice')}</Footnote>
        </Card>
        {topicGroupStatisticsPack.availability === 'pending' ? (
          <Card>
            <SectionTitle>{t('topics.officialGroups')}</SectionTitle>
            <Footnote>{t('topics.officialGroupsPending')}</Footnote>
            <Footnote>
              {t('topics.officialThroughYear', {
                first: topicGroupStatisticsPack.coverage.firstYear,
                last: topicGroupStatisticsPack.coverage.lastYear,
              })}
            </Footnote>
          </Card>
        ) : officialGroups.length ? (
          officialGroups.map((group) => (
            <Pressable
              accessibilityLabel={`${group.sourceLabelTr}, ${group.total} ${t('common.questions')}`}
              accessibilityRole="button"
              key={group.id}
              onPress={() =>
                router.push({
                  pathname: '/konular/dagilim/[grupId]',
                  params: { grupId: group.id },
                })
              }
            >
              <Card>
                <View style={styles.row}>
                  <View style={styles.grow}>
                    <Text style={[typography.headline, { color: colors.label }]}>
                      {group.sourceLabelTr}
                    </Text>
                    <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                      {t('topics.officialTotal', {
                        count: group.total,
                        first: topicGroupStatisticsPack.coverage.firstYear,
                        last: topicGroupStatisticsPack.coverage.lastYear,
                      })}
                    </Text>
                    {group.countingPolicy === 'alternative-included' ? (
                      <Text style={[typography.caption, { color: colors.warningText }]}>
                        {t('topics.alternativeIncludedNotice')}
                      </Text>
                    ) : null}
                  </View>
                  <MaterialIcons color={colors.tertiaryLabel} name="chevron-right" size={24} />
                </View>
              </Card>
            </Pressable>
          ))
        ) : (
          <Card>
            <Footnote>{t('topics.officialGroupsUnavailableForSubject')}</Footnote>
          </Card>
        )}
        {targetYear && targetYear > topicGroupStatisticsPack.coverage.lastYear ? (
          <Footnote>{t('topics.unpublishedYear', { year: targetYear })}</Footnote>
        ) : null}
      </Screen>
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
            {subject.id.startsWith('ydt') ? (
              <Card style={[styles.officialNotice, { borderLeftColor: colors.warning }]}>
                <Footnote color={colors.warningText}>{t('topics.ydtEnglishOnlyNotice')}</Footnote>
              </Card>
            ) : null}
            {modeControl}
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
          const officialStat = verifiedStats.length
            ? undefined
            : officialStats?.byTopic.get(item.id);
          const recentStats = verifiedStats.length
            ? verifiedStats.slice(-5)
            : (officialStat?.yearly.slice(-5) ?? []);
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
                    {officialStat ? (
                      <Text style={[typography.caption, { color: colors.secondaryLabel }]}>
                        {t('topics.officialCountsSource')}
                      </Text>
                    ) : null}
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
  officialNotice: { borderLeftWidth: 3 },
});

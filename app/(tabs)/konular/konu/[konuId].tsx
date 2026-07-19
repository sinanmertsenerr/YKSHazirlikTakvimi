import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { Redirect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { YearBarChart } from '@/components/charts';
import {
  AppHeader,
  Card,
  Chip,
  Footnote,
  PercentSlider,
  Screen,
  SectionTitle,
} from '@/components/ui';
import {
  findOfficialTopicGroup,
  findOfficialTopicGroupSource,
  findSubject,
  findTopic,
  officialStatsForSubject,
  topicGroupStatisticsPack,
  useContentRevisionStore,
} from '@/data/content';
import { percentToStatus } from '@/db/activity';
import { PendingYearBadge } from '@/features/topics/PendingYearBadge';
import { getVerifiedTopicStats } from '@/features/topics/statistics';
import { useAppData } from '@/providers/AppDataProvider';
import { useTheme } from '@/theme/useTheme';
import { formatInstantDate } from '@/utils/format';
import { allowedOgmHttpsUrl } from '@/utils/officialUrls';

// Named export for the regression tests of the unmount guard below; expo-router only
// treats the default export as the route.
export function TopicProgressEditor({
  initialPercent,
  progressKey,
  save,
}: {
  initialPercent: number;
  progressKey: string;
  save: (topicId: string, percent: number) => Promise<void>;
}) {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [percent, setPercent] = useState(initialPercent);
  // pending = latest slider value (visual only until commit); persisted = last value the DB
  // is known to hold, used as the rollback target when a commit fails.
  const pendingPercent = useRef(initialPercent);
  const persistedPercent = useRef(initialPercent);
  // commit() can resolve after this editor unmounts (successful saves remount it via the
  // updatedAt key); the guard keeps the failure path from touching unmounted state.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const derivedStatus = percentToStatus(percent);
  const statusLabel =
    derivedStatus === 'done'
      ? t('topics.done')
      : derivedStatus === 'working'
        ? t('topics.working')
        : t('topics.none');
  const statusColor =
    derivedStatus === 'done'
      ? colors.success
      : derivedStatus === 'working'
        ? colors.warning
        : colors.tertiaryLabel;

  // Dragging only moves local state; the single DB write happens on gesture end. The
  // skipped-commit guard keeps the rollback honest when a newer gesture is already pending.
  const slide = (value: number) => {
    pendingPercent.current = value;
    setPercent(value);
  };
  const commit = async () => {
    const next = pendingPercent.current;
    if (next === persistedPercent.current) return;
    try {
      await save(progressKey, next);
      persistedPercent.current = next;
    } catch {
      if (!alive.current) return;
      if (pendingPercent.current === next) {
        pendingPercent.current = persistedPercent.current;
        setPercent(persistedPercent.current);
      }
      Alert.alert(t('topics.statusTitle'), t('topics.progressSaveFailed'));
    }
  };

  return (
    <Card>
      <SectionTitle>{t('topics.statusTitle')}</SectionTitle>
      <View style={styles.statusHeader}>
        <Text style={[typography.largeTitle, { color: colors.label }]}>%{percent}</Text>
        <Text style={[typography.subhead, { color: statusColor }]}>{statusLabel}</Text>
      </View>
      <PercentSlider
        onChange={slide}
        onInteractEnd={() => {
          navigation.setOptions({ gestureEnabled: true });
          void commit();
        }}
        onInteractStart={() => navigation.setOptions({ gestureEnabled: false })}
        value={percent}
      />
    </Card>
  );
}

export default function TopicDetailScreen() {
  const { konuId, dersId } = useLocalSearchParams<{ konuId: string; dersId: string }>();
  useContentRevisionStore((state) => state.revision);
  const subject = findSubject(dersId);
  const topic = findTopic(dersId, konuId);
  const { progress, ready, setTopicProgress } = useAppData();
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const progressKey = `${dersId}:${konuId}`;
  const current = progress.find((item) => item.topicId === progressKey);
  // Root-memoized: both helpers build fresh arrays/maps per call, and this screen
  // re-renders on every slider step — without these, YearBarChart's own memo never hits.
  const verifiedStats = useMemo(() => getVerifiedTopicStats(topic?.yearlyStats ?? []), [topic]);
  const officialStat = useMemo(
    () =>
      subject && topic ? officialStatsForSubject(subject.id)?.byTopic.get(topic.id) : undefined,
    [subject, topic],
  );
  const verifiedChartData = useMemo(
    () => verifiedStats.map((stat) => ({ year: stat.year, value: stat.count })),
    [verifiedStats],
  );
  const officialChartData = useMemo(
    () => officialStat?.yearly.map((stat) => ({ year: stat.year, value: stat.count })) ?? [],
    [officialStat],
  );

  if (!subject || !topic) {
    return <Redirect href="/konular" />;
  }

  const officialStatistics =
    topicGroupStatisticsPack.availability === 'available' ? topicGroupStatisticsPack : undefined;
  const officialCoverage = officialStatistics?.coverage;
  // The study topic and its official MEB OGM group share the same id by construction. This
  // resolves both the reviewed source of the number the chart is drawn from and the link
  // students follow to reach that topic's past questions on the official MEB OGM page —
  // the app carries no per-question ÖSYM links of its own (topic.questions is empty pending
  // the editorial-consensus pipeline), so the official page is the single entry point.
  const officialGroup = findOfficialTopicGroup(topic.id);
  const officialSourceUrl = officialGroup
    ? allowedOgmHttpsUrl(findOfficialTopicGroupSource(officialGroup.sourceKey)?.resolverUrl)
    : null;
  const expectedLastYear = topic.yearlyStats.at(-1)?.year;
  // Data-driven: shows only while the topic's expected latest exam year is ahead of the
  // officially published coverage. Auto-clears when that year's data lands, and advances
  // to the next year on its own — no hardcoded year.
  const unpublishedYear =
    officialCoverage && expectedLastYear && expectedLastYear > officialCoverage.lastYear
      ? expectedLastYear
      : null;
  return (
    <Screen>
      <AppHeader back title={topic.name[language]} subtitle={subject.name[language]} />
      <View style={styles.chips}>
        <Chip
          backgroundColor={
            subject.id.startsWith('tyt')
              ? colors.tytSoft
              : subject.id.startsWith('ayt')
                ? colors.aytSoft
                : colors.ydtSoft
          }
          color={
            subject.id.startsWith('tyt')
              ? colors.tytText
              : subject.id.startsWith('ayt')
                ? colors.aytText
                : colors.ydtText
          }
        >
          {subject.id.startsWith('tyt') ? 'TYT' : subject.id.startsWith('ayt') ? 'AYT' : 'YDT'}
        </Chip>
        {unpublishedYear ? (
          <PendingYearBadge style={styles.pendingBadge} year={unpublishedYear} />
        ) : null}
      </View>

      <Card>
        <SectionTitle>{t('topics.yearlyQuestions')}</SectionTitle>
        {verifiedStats.length ? (
          <YearBarChart data={verifiedChartData} />
        ) : officialStat && officialCoverage ? (
          <>
            <YearBarChart data={officialChartData} />
            <Footnote>{t('topics.officialCountsSource')}</Footnote>
            {officialGroup && officialStatistics ? (
              <Footnote>
                {`${t('topics.verifiedOn', {
                  date: formatInstantDate(officialStatistics.verifiedAt, i18n.language),
                })} · ${t('topics.sourcePage', { page: officialGroup.physicalPage })}`}
              </Footnote>
            ) : null}
            {officialSourceUrl ? (
              <Pressable
                accessibilityHint={t('common.officialSource')}
                accessibilityLabel={t('topics.pastQuestions')}
                accessibilityRole="link"
                onPress={() =>
                  void WebBrowser.openBrowserAsync(officialSourceUrl).catch(() =>
                    Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
                  )
                }
                style={styles.pastQuestionsLink}
              >
                <MaterialIcons color={colors.brand} name="open-in-new" size={20} />
                <Text style={[typography.subhead, styles.linkText, { color: colors.brand }]}>
                  {t('topics.pastQuestions')}
                </Text>
              </Pressable>
            ) : null}
            {officialStat.alternativeIncluded ? (
              <Footnote color={colors.warningText}>
                {t('topics.alternativeIncludedNotice')}
              </Footnote>
            ) : null}
          </>
        ) : (
          <Footnote>{t('topics.unknownCount')}</Footnote>
        )}
      </Card>

      {ready ? (
        <TopicProgressEditor
          initialPercent={current?.percent ?? 0}
          key={`${progressKey}:${current?.updatedAt ?? 'new'}`}
          progressKey={progressKey}
          save={setTopicProgress}
        />
      ) : (
        <Card>
          <SectionTitle>{t('topics.statusTitle')}</SectionTitle>
          <ActivityIndicator
            accessibilityLabel={t('common.loading')}
            accessibilityRole="progressbar"
            color={colors.brand}
          />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  pendingBadge: { flex: 1 },
  statusHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 14 },
  pastQuestionsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingTop: 6,
  },
  linkText: { fontWeight: '700' },
});

import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { YearBarChart } from '@/components/charts';
import {
  AppHeader,
  Card,
  Chip,
  EmptyState,
  Footnote,
  Screen,
  SegmentedControl,
  SectionTitle,
} from '@/components/ui';
import {
  findSubject,
  findTopic,
  officialStatsForSubject,
  topicGroupStatisticsPack,
  useContentRevisionStore,
} from '@/data/content';
import type { TopicStatus } from '@/db/types';
import { getVerifiedTopicStats } from '@/features/topics/statistics';
import { useAppData } from '@/providers/AppDataProvider';
import { useTheme } from '@/theme/useTheme';
import { allowedOsymHttpsUrl } from '@/utils/officialUrls';

async function openOfficialUrl(url: string) {
  const officialUrl = allowedOsymHttpsUrl(url);
  if (!officialUrl) throw new Error('Unsafe external URL');
  await WebBrowser.openBrowserAsync(officialUrl);
}

export default function TopicDetailScreen() {
  const { konuId, dersId } = useLocalSearchParams<{ konuId: string; dersId: string }>();
  useContentRevisionStore((state) => state.revision);
  const subject = findSubject(dersId);
  const topic = findTopic(dersId, konuId);
  const { progress, setTopicProgress } = useAppData();
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const progressKey = `${dersId}:${konuId}`;
  const current = progress.find((item) => item.topicId === progressKey);
  const [status, setStatus] = useState<TopicStatus>(current?.status ?? 'none');
  const [confidence, setConfidence] = useState(current?.confidence ?? 0);

  if (!subject || !topic) {
    return (
      <Screen>
        <EmptyState body={t('common.topicNotFound')} icon="search-off" title={t('topics.title')} />
      </Screen>
    );
  }

  const save = async (nextStatus: TopicStatus, nextConfidence = confidence) => {
    const previousStatus = status;
    const previousConfidence = confidence;
    setStatus(nextStatus);
    try {
      await setTopicProgress(progressKey, nextStatus, nextConfidence || null);
    } catch {
      setStatus(previousStatus);
      setConfidence(previousConfidence);
      Alert.alert(t('topics.statusTitle'), t('topics.progressSaveFailed'));
    }
  };
  const verifiedStats = getVerifiedTopicStats(topic.yearlyStats);
  const officialStat = officialStatsForSubject(subject.id)?.byTopic.get(topic.id);
  const officialCoverage =
    topicGroupStatisticsPack.availability === 'available'
      ? topicGroupStatisticsPack.coverage
      : undefined;

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
      </View>

      <Card>
        <SectionTitle>{t('topics.yearlyQuestions')}</SectionTitle>
        {verifiedStats.length ? (
          <YearBarChart
            data={verifiedStats.map((stat, index) => ({
              index,
              value: stat.count,
              label: `'${String(stat.year).slice(-2)}`,
            }))}
          />
        ) : officialStat && officialCoverage ? (
          <>
            <YearBarChart
              data={officialStat.yearly.map((stat, index) => ({
                index,
                value: stat.count,
                label: `'${String(stat.year).slice(-2)}`,
              }))}
            />
            <Footnote>
              {t('topics.officialTotal', {
                count: officialStat.total,
                first: officialCoverage.firstYear,
                last: officialCoverage.lastYear,
              })}
            </Footnote>
            <Footnote>{t('topics.officialCountsSource')}</Footnote>
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

      <Card>
        <SectionTitle>{t('topics.statusTitle')}</SectionTitle>
        <SegmentedControl
          accessibilityLabel={t('topics.statusTitle')}
          onChange={(value) => void save(value)}
          options={[
            { label: t('topics.none'), value: 'none' },
            { label: t('topics.working'), value: 'working' },
            { label: t('topics.done'), value: 'done' },
          ]}
          value={status}
        />
        <Text style={[typography.footnote, { color: colors.secondaryLabel, marginBottom: 4 }]}>
          {t('topics.confidence')}
        </Text>
        <View accessibilityRole="radiogroup" style={styles.stars}>
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable
              accessibilityLabel={`${value} / 5`}
              accessibilityRole="radio"
              accessibilityState={{ checked: confidence === value }}
              key={value}
              onPress={() => {
                const previousConfidence = confidence;
                setConfidence(value);
                void setTopicProgress(progressKey, status, value).catch(() => {
                  setConfidence(previousConfidence);
                  Alert.alert(t('topics.statusTitle'), t('topics.progressSaveFailed'));
                });
              }}
              style={styles.starButton}
            >
              <MaterialIcons
                color={value <= confidence ? colors.warning : colors.tertiaryLabel}
                name={value <= confidence ? 'star' : 'star-border'}
                size={30}
              />
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('topics.pastQuestions')}</SectionTitle>
        {topic.questions.length ? (
          topic.questions.map((question, index) => (
            <Pressable
              accessibilityHint={t('common.officialSource')}
              accessibilityRole="link"
              key={`${question.year}-${question.sourceExam}-${question.questionBlockId}-${question.officialQuestionNo}-${question.role}-${index}`}
              onPress={() =>
                void openOfficialUrl(question.sourceUrl).catch(() =>
                  Alert.alert(t('common.externalLink'), t('common.retry')),
                )
              }
              style={[styles.questionRow, { borderTopColor: colors.separator }]}
            >
              <Chip backgroundColor={colors.brandSoft} color={colors.brand}>
                {question.role === 'related'
                  ? '↔ '
                  : question.role === 'alternative'
                    ? `${t('topics.alternativeQuestion')} · `
                    : ''}
                {question.sourceExam.toUpperCase()} · {question.year} · S.
                {question.officialQuestionNo}
              </Chip>
              {question.descriptor ? (
                <Text style={[typography.footnote, { color: colors.label, flex: 1 }]}>
                  {question.descriptor[language]}
                </Text>
              ) : null}
              {question.difficulty ? (
                <Text style={[typography.caption, { color: colors.secondaryLabel }]}>
                  {question.difficulty}
                </Text>
              ) : null}
              <MaterialIcons color={colors.tertiaryLabel} name="open-in-new" size={20} />
            </Pressable>
          ))
        ) : (
          <Footnote>{t('topics.unknownCount')}</Footnote>
        )}
        <Footnote>{t('topics.questionCopyright')}</Footnote>
      </Card>

      <Card>
        <SectionTitle>{t('topics.outcomes')}</SectionTitle>
        {topic.outcomes?.length ? (
          topic.outcomes.map((outcome) => (
            <View key={outcome.tr} style={styles.outcome}>
              <MaterialIcons color={colors.brand} name="check-circle-outline" size={20} />
              <Text style={[typography.footnote, { color: colors.label, flex: 1 }]}>
                {outcome[language]}
              </Text>
            </View>
          ))
        ) : (
          <Footnote>{t('common.unverified')}</Footnote>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  stars: { flexDirection: 'row', flexWrap: 'wrap' },
  starButton: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  questionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  outcome: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
});

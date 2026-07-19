import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AppHeader,
  Card,
  Footnote,
  ProgressBar,
  ProgressRing,
  Screen,
  SegmentedControl,
} from '@/components/ui';
import { allSubjects, topicsPack, useContentRevisionStore } from '@/data/content';
import { getAverageTopicProgress } from '@/features/topics/statistics';
import { useAppData } from '@/providers/AppDataProvider';
import { useTheme } from '@/theme/useTheme';

type ExamId = 'tyt' | 'ayt' | 'ydt';

export default function TopicsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const router = useRouter();
  const { progress } = useAppData();
  const [examId, setExamId] = useState<ExamId>('tyt');
  useContentRevisionStore((state) => state.revision);
  const subjects = allSubjects(examId);
  const progressByTopicId = useMemo(
    () => new Map(progress.map((item) => [item.topicId, item] as const)),
    [progress],
  );
  const examProgress = getAverageTopicProgress(
    subjects.flatMap((subject) => subject.topics.map((topic) => `${subject.id}:${topic.id}`)),
    progressByTopicId,
  );
  const examPercent = Math.round(examProgress * 100);
  const examProgressColor =
    examProgress >= 1 ? colors.success : examProgress > 0 ? colors.warning : colors.tertiaryLabel;
  const examProgressTextColor =
    examProgress >= 1
      ? colors.successText
      : examProgress > 0
        ? colors.warningText
        : colors.tertiaryLabel;

  return (
    <Screen>
      <AppHeader title={t('topics.title')} subtitle={t('topics.subtitle')} />
      {!topicsPack.dataStatus.verified ? (
        <Card style={[styles.notice, { borderLeftColor: colors.warning }]}>
          <Footnote color={colors.warningText}>{t('topics.editorialTaxonomy')}</Footnote>
        </Card>
      ) : null}
      <SegmentedControl
        accessibilityLabel="TYT AYT YDT"
        onChange={setExamId}
        options={[
          { label: 'TYT', value: 'tyt' },
          { label: 'AYT', value: 'ayt' },
          { label: 'YDT', value: 'ydt' },
        ]}
        value={examId}
      />
      <Card>
        <View style={styles.progressHeader}>
          <Text style={[typography.subhead, styles.progressTitle, { color: colors.label }]}>
            {t('topics.examProgress', { exam: examId.toUpperCase() })}
          </Text>
          <Text
            style={[typography.subhead, styles.progressPercent, { color: examProgressTextColor }]}
          >
            %{examPercent}
          </Text>
        </View>
        <ProgressBar color={examProgressColor} progress={examProgress} />
      </Card>
      {subjects.map((subject) => {
        const topicProgressIds = subject.topics.map((topic) => `${subject.id}:${topic.id}`);
        const done = topicProgressIds.filter(
          (topicId) => (progressByTopicId.get(topicId)?.percent ?? 0) >= 100,
        ).length;
        const ratio = getAverageTopicProgress(topicProgressIds, progressByTopicId);
        const ringColor =
          ratio >= 1 ? colors.success : ratio > 0 ? colors.warning : colors.tertiaryLabel;
        const ringLabelColor =
          ratio >= 1 ? colors.successText : ratio > 0 ? colors.warningText : colors.tertiaryLabel;
        return (
          <Pressable
            accessibilityLabel={`${subject.name[i18n.language === 'en' ? 'en' : 'tr']}, ${Math.round(ratio * 100)}%`}
            accessibilityRole="button"
            key={subject.id}
            onPress={() => router.push(`/konular/${subject.id}`)}
          >
            <Card>
              <View style={styles.row}>
                <ProgressRing color={ringColor} labelColor={ringLabelColor} progress={ratio} />
                <View style={styles.grow}>
                  <Text style={[typography.headline, { color: colors.label }]}>
                    {subject.name[i18n.language === 'en' ? 'en' : 'tr']}
                  </Text>
                  <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                    {subject.questionCount == null ? '~' : subject.questionCount}{' '}
                    {t('common.questions')} ·{' '}
                    {t('topics.completed', { done, total: subject.topics.length })}
                  </Text>
                </View>
                <MaterialIcons color={colors.tertiaryLabel} name="chevron-right" size={24} />
              </View>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { borderLeftWidth: 3 },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  progressTitle: { flex: 1, fontWeight: '700' },
  progressPercent: { fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
});

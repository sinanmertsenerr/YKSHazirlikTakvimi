import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Card, Footnote, ProgressRing, Screen, SegmentedControl } from '@/components/ui';
import { allSubjects, topicsPack, useContentRevisionStore } from '@/data/content';
import { useAppData } from '@/providers/AppDataProvider';
import { useTheme } from '@/theme/useTheme';

type ExamId = 'tyt' | 'ayt';

export default function TopicsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const router = useRouter();
  const { progress } = useAppData();
  const [examId, setExamId] = useState<ExamId>('tyt');
  useContentRevisionStore((state) => state.revision);
  const subjects = allSubjects(examId);

  return (
    <Screen>
      <AppHeader title={t('topics.title')} subtitle={t('topics.subtitle')} />
      {!topicsPack.dataStatus.verified ? (
        <Card style={[styles.notice, { borderLeftColor: colors.warning }]}>
          <Footnote color={colors.warningText}>{t('topics.editorialTaxonomy')}</Footnote>
        </Card>
      ) : null}
      <SegmentedControl
        accessibilityLabel="TYT AYT"
        onChange={setExamId}
        options={[
          { label: 'TYT', value: 'tyt' },
          { label: 'AYT', value: 'ayt' },
        ]}
        value={examId}
      />
      {subjects.map((subject) => {
        const done = subject.topics.filter(
          (topic) =>
            progress.find((item) => item.topicId === `${subject.id}:${topic.id}`)?.status ===
            'done',
        ).length;
        const ratio = subject.topics.length ? done / subject.topics.length : 0;
        const semanticColor = examId === 'tyt' ? colors.tyt : colors.ayt;
        const textColor = examId === 'tyt' ? colors.tytText : colors.aytText;
        return (
          <Pressable
            accessibilityLabel={`${subject.name[i18n.language === 'en' ? 'en' : 'tr']}, ${Math.round(ratio * 100)}%`}
            accessibilityRole="button"
            key={subject.id}
            onPress={() => router.push(`/konular/${subject.id}`)}
          >
            <Card>
              <View style={styles.row}>
                <ProgressRing color={semanticColor} progress={ratio} />
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
                <Text style={[typography.footnote, styles.percent, { color: textColor }]}>
                  %{Math.round(ratio * 100)}
                </Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  percent: { fontWeight: '800' },
});

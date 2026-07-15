import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';

import { NetLineChart } from '@/components/charts';
import {
  AppHeader,
  Button,
  Card,
  Chip,
  EmptyState,
  ProgressBar,
  Screen,
  SegmentedControl,
  SectionTitle,
  Stat,
} from '@/components/ui';
import { examSections, localized } from '@/data/examStructure';
import type { ExamType } from '@/db/types';
import { average, sectionAverages, totalExamNet } from '@/features/progress/calculations';
import { useAppData } from '@/providers/AppDataProvider';
import { useSettingsStore } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';
import { formatInstantDate, formatNumber } from '@/utils/format';

type Period = '5' | '10' | 'all';

export default function ProgressScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography } = useTheme();
  const { exams, removeExam } = useAppData();
  const targetNet = useSettingsStore((state) => state.targetNet);
  const [examType, setExamType] = useState<ExamType>('tyt');
  const [period, setPeriod] = useState<Period>('5');

  const allForType = useMemo(
    () => exams.filter((exam) => exam.exam === examType).sort((a, b) => b.date - a.date),
    [examType, exams],
  );
  const selected = period === 'all' ? allForType : allForType.slice(0, Number(period));
  const chronological = [...selected].reverse();
  const totals = selected.map(totalExamNet);
  const latest = allForType[0];
  const breakdown = sectionAverages(selected).sort((a, b) => a.average - b.average);
  const weakest = new Set(breakdown.slice(0, 3).map((item) => item.sectionId));

  const confirmDelete = (id: string) => {
    Alert.alert(t('common.delete'), t('progress.confirmDelete'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void removeExam(id) },
    ]);
  };

  return (
    <Screen>
      <AppHeader title={t('progress.title')} subtitle={t('progress.subtitle')} />
      <SegmentedControl
        accessibilityLabel="TYT AYT YDT"
        onChange={setExamType}
        options={[
          { label: 'TYT', value: 'tyt' },
          { label: 'AYT', value: 'ayt' },
          { label: 'YDT', value: 'ydt' },
        ]}
        value={examType}
      />
      <SegmentedControl
        accessibilityLabel={t('progress.period')}
        onChange={setPeriod}
        options={[
          { label: t('progress.last5'), value: '5' },
          { label: t('progress.last10'), value: '10' },
          { label: t('common.all'), value: 'all' },
        ]}
        value={period}
      />

      <View style={styles.stats}>
        <Stat
          label={t('progress.lastNet')}
          value={formatNumber(latest ? totalExamNet(latest) : 0, i18n.language)}
        />
        <Stat
          label={t('progress.average', { count: selected.length || 5 })}
          value={formatNumber(average(totals), i18n.language)}
        />
        <Stat
          color={colors.brand}
          label={t('progress.target')}
          value={formatNumber(targetNet, i18n.language)}
        />
      </View>

      {!latest ? (
        <EmptyState
          action={{
            title: t('progress.addExam'),
            onPress: () => router.push('/gelisim/deneme/yeni'),
          }}
          body={t('progress.noExamsBody')}
          icon="monitor-heart"
          title={t('progress.noExams')}
        />
      ) : (
        <>
          <Card>
            <SectionTitle>{`${t('progress.chart')} · ${selected.length}`}</SectionTitle>
            <NetLineChart
              data={chronological.map((exam, index) => ({
                index,
                value: totalExamNet(exam),
                label: formatInstantDate(exam.date, i18n.language),
              }))}
              target={targetNet}
            />
          </Card>

          <Card>
            <SectionTitle>{t('progress.breakdown')}</SectionTitle>
            {breakdown.map((item) => {
              const definition = examSections.find((section) => section.id === item.sectionId);
              const max = definition?.questionCount ?? 40;
              const weak = weakest.has(item.sectionId);
              return (
                <View key={item.sectionId} style={styles.breakdownRow}>
                  <Text
                    numberOfLines={1}
                    style={[typography.footnote, { color: colors.label, width: 88 }]}
                  >
                    {definition ? localized(definition.name, i18n.language) : item.sectionId}
                  </Text>
                  <ProgressBar
                    color={weak ? colors.warning : colors[examType]}
                    progress={Math.max(0, item.average / max)}
                  />
                  <Text
                    style={[
                      typography.footnote,
                      {
                        color: weak ? colors.warningText : colors.label,
                        fontWeight: '700',
                        width: 42,
                        textAlign: 'right',
                      },
                    ]}
                  >
                    {formatNumber(item.average, i18n.language, 1)}
                  </Text>
                </View>
              );
            })}
          </Card>
        </>
      )}

      <SectionTitle
        action={
          <Chip
            backgroundColor={colors.brand}
            color={colors.onBrand}
            onPress={() => router.push('/gelisim/deneme/yeni')}
          >
            + {t('progress.addExam')}
          </Chip>
        }
      >
        {t('progress.exams')}
      </SectionTitle>
      {allForType.map((exam, index) => {
        const currentTotal = totalExamNet(exam);
        const older = allForType[index + 1];
        const difference = older ? currentTotal - totalExamNet(older) : null;
        return (
          <Swipeable
            key={exam.id}
            overshootRight={false}
            renderRightActions={() => (
              <Pressable
                accessibilityLabel={t('common.delete')}
                accessibilityRole="button"
                onPress={() => confirmDelete(exam.id)}
                style={[styles.deleteAction, { backgroundColor: colors.danger }]}
              >
                <MaterialIcons color="#fff" name="delete" size={24} />
              </Pressable>
            )}
          >
            <Pressable
              accessibilityActions={[{ name: 'delete', label: t('common.delete') }]}
              accessibilityHint={t('progress.examA11yHint')}
              accessibilityRole="button"
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'delete') confirmDelete(exam.id);
              }}
              onPress={() => router.push(`/gelisim/deneme/${exam.id}`)}
            >
              <Card style={styles.examCard}>
                <View style={styles.examRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.headline, { color: colors.label }]}>
                      {exam.publisher || `${exam.exam.toUpperCase()} ${t('progress.exams')}`}
                    </Text>
                    <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                      {formatInstantDate(exam.date, i18n.language)}
                    </Text>
                  </View>
                  <Text style={[styles.examNet, { color: colors.label }]}>
                    {formatNumber(currentTotal, i18n.language)}
                  </Text>
                  {difference == null ? null : (
                    <MaterialIcons
                      accessibilityLabel={
                        difference >= 0 ? t('common.increase') : t('common.decrease')
                      }
                      color={difference >= 0 ? colors.successText : colors.danger}
                      name={difference >= 0 ? 'trending-up' : 'trending-down'}
                      size={22}
                    />
                  )}
                  <MaterialIcons color={colors.tertiaryLabel} name="chevron-right" size={24} />
                </View>
              </Card>
            </Pressable>
          </Swipeable>
        );
      })}
      {!allForType.length ? (
        <Button onPress={() => router.push('/gelisim/deneme/yeni')} title={t('progress.addExam')} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  deleteAction: {
    width: 72,
    minHeight: 72,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  examCard: { minHeight: 72 },
  examRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  examNet: { fontSize: 18, lineHeight: 24, fontWeight: '800' },
});

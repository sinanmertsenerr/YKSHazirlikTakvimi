import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AppHeader,
  Button,
  Card,
  Field,
  Screen,
  SegmentedControl,
  SectionTitle,
} from '@/components/ui';
import { sectionsForExam, localized } from '@/data/examStructure';
import type { ExamRecord, ExamSectionRecord, ExamType } from '@/db/types';
import { useAppData } from '@/providers/AppDataProvider';
import { calculateNet, validateSectionAnswers } from '@/scoring';
import { useTheme } from '@/theme/useTheme';
import {
  displayDatePattern,
  formatDateOnly,
  formatInstantDate,
  formatNumber,
  parseDisplayDate,
} from '@/utils/format';

function emptySections(exam: ExamType): ExamSectionRecord[] {
  return sectionsForExam(exam).map((section) => ({
    sectionId: section.id,
    correct: 0,
    wrong: 0,
    blank: 0,
  }));
}

export function ExamForm({ existing }: { existing?: ExamRecord }) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const { saveExam } = useAppData();
  const router = useRouter();
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const previousLanguage = useRef(language);
  const [recordId] = useState(() => existing?.id ?? Crypto.randomUUID());
  const saveInFlight = useRef(false);
  const [exam, setExam] = useState<ExamType>(existing?.exam ?? 'tyt');
  const [date, setDate] = useState(() => formatInstantDate(existing?.date ?? Date.now(), language));
  const [publisher, setPublisher] = useState(existing?.publisher ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [sections, setSections] = useState<ExamSectionRecord[]>(
    existing?.sections ?? emptySections(existing?.exam ?? 'tyt'),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const structure = useMemo(() => sectionsForExam(exam), [exam]);
  const total = sections.reduce((sum, section) => sum + calculateNet(section), 0);

  useEffect(() => {
    const previous = previousLanguage.current;
    if (previous === language) return;
    setDate((current) => {
      const dateOnly = parseDisplayDate(current, previous);
      return dateOnly ? formatDateOnly(dateOnly, language) : current;
    });
    previousLanguage.current = language;
  }, [language]);

  const setValue = (sectionId: string, key: 'correct' | 'wrong' | 'blank', value: string) => {
    const parsed = Number(value.replace(/\D/g, '')) || 0;
    setSections((current) =>
      current.map((section) =>
        section.sectionId === sectionId ? { ...section, [key]: parsed } : section,
      ),
    );
  };

  const onSave = async () => {
    const nextErrors: Record<string, string> = {};
    for (const section of sections) {
      const definition = structure.find((item) => item.id === section.sectionId);
      if (!definition) continue;
      const error = validateSectionAnswers(section, definition.questionCount);
      if (error) {
        nextErrors[section.sectionId] = t('progress.sectionLimit', {
          count: definition.questionCount,
        });
      }
    }
    const dateOnly = parseDisplayDate(date, language);
    const parsedDate = dateOnly ? new Date(`${dateOnly}T12:00:00+03:00`).getTime() : Number.NaN;
    if (!dateOnly || Number.isNaN(parsedDate)) {
      nextErrors.date = t('progress.dateFormat', { format: displayDatePattern(language) });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (saveInFlight.current) return;

    saveInFlight.current = true;
    setSaving(true);
    try {
      await saveExam({
        id: recordId,
        date: parsedDate,
        exam,
        publisher: publisher.trim(),
        notes: notes.trim(),
        sections,
      });
      Alert.alert(t('progress.examSaved'));
      router.back();
    } catch {
      saveInFlight.current = false;
      setSaving(false);
      Alert.alert(t('progress.saveFailed'), t('common.retry'));
    }
  };

  return (
    <Screen>
      <AppHeader back title={existing ? t('progress.editExam') : t('progress.addExam')} />
      <SegmentedControl
        accessibilityLabel={t('progress.examType')}
        onChange={(value) => {
          setExam(value);
          setSections(emptySections(value));
          setErrors({});
        }}
        options={[
          { label: 'TYT', value: 'tyt' },
          { label: 'AYT', value: 'ayt' },
        ]}
        value={exam}
      />
      <Card>
        <Field
          error={errors.date}
          label={t('progress.date')}
          onChangeText={setDate}
          placeholder={formatDateOnly('2026-02-06', language)}
          value={date}
        />
        <Field
          label={t('progress.publisher')}
          onChangeText={setPublisher}
          placeholder={t('progress.publisherPlaceholder')}
          value={publisher}
        />
        <Field label={t('progress.notes')} multiline onChangeText={setNotes} value={notes} />
      </Card>

      <SectionTitle>{`${exam.toUpperCase()} · ${formatNumber(total, i18n.language)} ${t('common.net')}`}</SectionTitle>
      {structure.map((definition) => {
        const section = sections.find((item) => item.sectionId === definition.id) ?? {
          sectionId: definition.id,
          correct: 0,
          wrong: 0,
          blank: 0,
        };
        return (
          <Card key={definition.id}>
            <View style={styles.sectionHeading}>
              <Text style={[typography.headline, { color: colors.label, flex: 1 }]}>
                {localized(definition.name, i18n.language)}
              </Text>
              <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                {formatNumber(calculateNet(section), i18n.language)} / {definition.questionCount}
              </Text>
            </View>
            <View style={styles.inputs}>
              <Field
                keyboardType="number-pad"
                label={t('progress.correct')}
                maxLength={3}
                onChangeText={(value) => setValue(definition.id, 'correct', value)}
                containerStyle={styles.input}
                value={String(section.correct)}
              />
              <Field
                keyboardType="number-pad"
                label={t('progress.wrong')}
                maxLength={3}
                onChangeText={(value) => setValue(definition.id, 'wrong', value)}
                containerStyle={styles.input}
                value={String(section.wrong)}
              />
              <Field
                keyboardType="number-pad"
                label={t('progress.blank')}
                maxLength={3}
                onChangeText={(value) => setValue(definition.id, 'blank', value)}
                containerStyle={styles.input}
                value={String(section.blank)}
              />
            </View>
            {errors[definition.id] ? (
              <Text
                accessibilityLiveRegion="assertive"
                style={[typography.footnote, { color: colors.danger }]}
              >
                {errors[definition.id]}
              </Text>
            ) : null}
          </Card>
        );
      })}
      <Button
        disabled={saving}
        onPress={() => void onSave()}
        title={saving ? t('common.loading') : t('common.save')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  inputs: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minWidth: 0, marginBottom: 0 },
});

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
import { calculateNet, updateSectionAnswer, validateSectionAnswers } from '@/scoring';
import { useTheme } from '@/theme/useTheme';
import {
  displayDatePattern,
  formatDateOnly,
  formatInstantDate,
  formatNumber,
  parseDisplayDate,
} from '@/utils/format';

type AnswerKey = 'correct' | 'wrong' | 'blank';

type ExamSectionInput = {
  sectionId: string;
  correct: string;
  wrong: string;
  blank: string;
};

function emptySections(exam: ExamType): ExamSectionRecord[] {
  return sectionsForExam(exam).map((section) => ({
    sectionId: section.id,
    correct: 0,
    wrong: 0,
    blank: 0,
  }));
}

function toSectionInputs(sections: ExamSectionRecord[]): ExamSectionInput[] {
  return sections.map((section) => ({
    sectionId: section.sectionId,
    correct: String(section.correct),
    wrong: String(section.wrong),
    blank: String(section.blank),
  }));
}

function toSectionRecord(section: ExamSectionInput): ExamSectionRecord {
  return {
    sectionId: section.sectionId,
    correct: Number(section.correct) || 0,
    wrong: Number(section.wrong) || 0,
    blank: Number(section.blank) || 0,
  };
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
  const [sectionInputs, setSectionInputs] = useState<ExamSectionInput[]>(() =>
    toSectionInputs(existing?.sections ?? emptySections(existing?.exam ?? 'tyt')),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const structure = useMemo(() => sectionsForExam(exam), [exam]);
  const sections = useMemo(() => sectionInputs.map(toSectionRecord), [sectionInputs]);
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

  const setValue = (sectionId: string, key: AnswerKey, value: string, questionCount: number) => {
    const sanitized = value.replace(/\D/g, '');
    const parsed = Number(sanitized) || 0;
    setSectionInputs((current) =>
      current.map((section) => {
        if (section.sectionId !== sectionId) return section;
        const updated = updateSectionAnswer(toSectionRecord(section), key, parsed, questionCount);
        return updated ? { ...section, [key]: sanitized } : section;
      }),
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
      Alert.alert(t('progress.title'), t('progress.saveFailed'));
    }
  };

  return (
    <Screen>
      <AppHeader back title={existing ? t('progress.editExam') : t('progress.addExam')} />
      <SegmentedControl
        accessibilityLabel={t('progress.examType')}
        onChange={(value) => {
          setExam(value);
          setSectionInputs(toSectionInputs(emptySections(value)));
          setErrors({});
        }}
        options={[
          { label: 'TYT', value: 'tyt' },
          { label: 'AYT', value: 'ayt' },
          { label: 'YDT', value: 'ydt' },
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
        const sectionInput = sectionInputs.find((item) => item.sectionId === definition.id) ?? {
          sectionId: definition.id,
          correct: '',
          wrong: '',
          blank: '',
        };
        const section = toSectionRecord(sectionInput);
        const sectionError = errors[definition.id];
        return (
          <Card key={definition.id}>
            <View style={styles.sectionHeading}>
              <Text
                numberOfLines={1}
                style={[typography.headline, { color: colors.label, flex: 1, minWidth: 0 }]}
              >
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
                maxLength={String(definition.questionCount).length}
                testID={`${definition.id}-correct`}
                onChangeText={(value) =>
                  setValue(definition.id, 'correct', value, definition.questionCount)
                }
                containerStyle={styles.input}
                value={sectionInput.correct}
              />
              <Field
                keyboardType="number-pad"
                label={t('progress.wrong')}
                maxLength={String(definition.questionCount).length}
                testID={`${definition.id}-wrong`}
                onChangeText={(value) =>
                  setValue(definition.id, 'wrong', value, definition.questionCount)
                }
                containerStyle={styles.input}
                value={sectionInput.wrong}
              />
              <Field
                keyboardType="number-pad"
                label={t('progress.blank')}
                maxLength={String(definition.questionCount).length}
                testID={`${definition.id}-blank`}
                onChangeText={(value) =>
                  setValue(definition.id, 'blank', value, definition.questionCount)
                }
                containerStyle={styles.input}
                value={sectionInput.blank}
              />
            </View>
            <Text
              accessibilityLiveRegion={sectionError ? 'assertive' : 'none'}
              style={[
                typography.footnote,
                { color: sectionError ? colors.danger : colors.secondaryLabel },
              ]}
            >
              {sectionError ??
                t('progress.sectionLimit', {
                  count: definition.questionCount,
                })}
            </Text>
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

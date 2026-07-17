import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type {
  ProgramNetSubject,
  ProgramQuotaCategory,
} from '../../../scripts/lib/content-schemas';

import { Card, Chip, Footnote, SectionTitle } from '@/components/ui';
import type { ProgramExtras } from '@/db/programRepository';
import { useTheme } from '@/theme/useTheme';
import { formatNumber } from '@/utils/format';

// Official display order of the YÖK Atlas "Kontenjan ve Yerleşme" table.
const QUOTA_CATEGORY_ORDER: readonly ProgramQuotaCategory[] = [
  'genel',
  'kadin-34',
  'sehit-gazi',
  'deprem',
  'okul-birincisi',
];

const QUOTA_CATEGORY_LABEL_KEYS = {
  genel: 'preference.quotaCategoryGenel',
  'okul-birincisi': 'preference.quotaCategoryOkulBirincisi',
  deprem: 'preference.quotaCategoryDeprem',
  'sehit-gazi': 'preference.quotaCategorySehitGazi',
  'kadin-34': 'preference.quotaCategoryKadin34',
} as const satisfies Record<ProgramQuotaCategory, string>;

// Follows the official panel order: TYT, AYT, YDT.
const NET_SUBJECT_LABEL_KEYS = {
  tytTurkce: 'preference.netTytTurkce',
  tytSosyal: 'preference.netTytSosyal',
  tytMatematik: 'preference.netTytMatematik',
  tytFen: 'preference.netTytFen',
  aytMatematik: 'preference.netAytMatematik',
  aytFizik: 'preference.netAytFizik',
  aytKimya: 'preference.netAytKimya',
  aytBiyoloji: 'preference.netAytBiyoloji',
  aytEdebiyat: 'preference.netAytEdebiyat',
  aytTarih1: 'preference.netAytTarih1',
  aytCografya1: 'preference.netAytCografya1',
  aytTarih2: 'preference.netAytTarih2',
  aytCografya2: 'preference.netAytCografya2',
  aytFelsefe: 'preference.netAytFelsefe',
  aytDin: 'preference.netAytDin',
  ydtDil: 'preference.netYdtDil',
} as const satisfies Record<ProgramNetSubject, string>;

function InfoRow({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.infoRow, { borderTopColor: colors.separator }]}>
      <Text style={[typography.footnote, styles.infoLabel, { color: colors.secondaryLabel }]}>
        {label}
      </Text>
      <Text selectable style={[typography.footnote, styles.infoValue, { color: colors.label }]}>
        {value}
      </Text>
    </View>
  );
}

/** Program künyesi: faculty, district, education type, duration, tuition, accreditation… */
export function ProgramFactsCard({
  extras,
  language,
}: {
  extras: ProgramExtras;
  language: 'tr' | 'en';
}) {
  const { t } = useTranslation();
  const rows: { key: string; label: string; value: string }[] = [];
  const push = (key: string, label: string, value: string | null) => {
    if (value) rows.push({ key, label, value });
  };
  push('faculty', t('preference.faculty'), extras.faculty);
  push('district', t('preference.district'), extras.district);
  push('educationType', t('preference.educationType'), extras.educationType);
  push(
    'duration',
    t('preference.duration'),
    extras.durationYears === null
      ? null
      : t('preference.durationYears', { count: extras.durationYears }),
  );
  push('programGroup', t('preference.programGroup'), extras.programGroup);
  push(
    'tuition',
    t('preference.tuition'),
    extras.tuition === null ? null : `${formatNumber(extras.tuition, language, 0)} TL`,
  );
  push(
    'accreditation',
    t('preference.accreditation'),
    extras.accreditation === null
      ? null
      : extras.accreditationNote
        ? `${extras.accreditation} — ${extras.accreditationNote}`
        : extras.accreditation,
  );
  if (extras.tyc) push('tyc', t('preference.tyc'), t('preference.tycPresent'));
  push('appliedEducationModel', t('preference.appliedEducationModel'), extras.appliedEducationModel);
  push(
    'minRankRequirement',
    t('preference.minRankRequirement'),
    extras.minRankRequirement === null
      ? null
      : formatNumber(extras.minRankRequirement, language, 0),
  );
  if (!rows.length) return null;
  return (
    <Card>
      <SectionTitle>{t('preference.detailsTitle')}</SectionTitle>
      {rows.map((row) => (
        <InfoRow key={row.key} label={row.label} value={row.value} />
      ))}
      {extras.minRankRequirement !== null && extras.minRankRequirementNote ? (
        <Footnote>{extras.minRankRequirementNote}</Footnote>
      ) : null}
    </Card>
  );
}

/** Official quota-category table with the placed counts and occupancy of the snapshot year. */
export function QuotaCategoriesCard({
  extras,
  language,
}: {
  extras: ProgramExtras;
  language: 'tr' | 'en';
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!extras.quotaCategories.length) return null;
  const year = Math.max(...extras.quotaCategories.map((category) => category.year));
  const categories = extras.quotaCategories
    .filter((category) => category.year === year)
    .sort(
      (left, right) =>
        QUOTA_CATEGORY_ORDER.indexOf(left.category) - QUOTA_CATEGORY_ORDER.indexOf(right.category),
    );
  if (!categories.length) return null;
  const totalQuota = categories.reduce((total, category) => total + (category.quota ?? 0), 0);
  const totalPlaced = categories.every((category) => category.placed === null)
    ? null
    : categories.reduce((total, category) => total + (category.placed ?? 0), 0);
  const emptySeats = totalPlaced === null ? null : Math.max(0, totalQuota - totalPlaced);

  return (
    <Card>
      <SectionTitle
        action={
          totalPlaced !== null ? (
            <Chip
              backgroundColor={emptySeats === 0 ? colors.brandSoft : colors.surface}
              color={emptySeats === 0 ? colors.brand : colors.label}
            >
              {emptySeats === 0
                ? t('preference.occupancyFull')
                : `${t('preference.occupancyNotFull')} · ${t('preference.emptySeats', { count: emptySeats })}`}
            </Chip>
          ) : undefined
        }
      >
        {t('preference.quotaSection')} · {year}
      </SectionTitle>
      <View style={[styles.tableHeader, { borderTopColor: colors.separator }]}>
        <Text style={[typography.caption, styles.categoryName, { color: colors.secondaryLabel }]} />
        <Text style={[typography.caption, styles.tableCell, { color: colors.secondaryLabel }]}>
          {t('preference.quota')}
        </Text>
        <Text style={[typography.caption, styles.tableCell, { color: colors.secondaryLabel }]}>
          {t('preference.placed')}
        </Text>
      </View>
      {categories.map((category) => (
        <View
          key={category.category}
          style={[styles.tableRow, { borderTopColor: colors.separator }]}
        >
          <Text
            numberOfLines={2}
            style={[typography.footnote, styles.categoryName, { color: colors.label }]}
          >
            {t(QUOTA_CATEGORY_LABEL_KEYS[category.category])}
          </Text>
          <Text style={[typography.footnote, styles.tableCell, { color: colors.label }]}>
            {category.quota === null ? '—' : formatNumber(category.quota, language, 0)}
          </Text>
          <Text style={[typography.footnote, styles.tableCell, { color: colors.label }]}>
            {category.placed === null ? '—' : formatNumber(category.placed, language, 0)}
          </Text>
        </View>
      ))}
    </Card>
  );
}

/** "Yerleşen Son Kişinin Netleri": per-year subject nets with OBP and placement score. */
export function ProgramNetsCard({
  extras,
  language,
}: {
  extras: ProgramExtras;
  language: 'tr' | 'en';
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const years = extras.nets.map((net) => net.year);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  if (!extras.nets.length) return null;
  const activeYear = selectedYear !== null && years.includes(selectedYear) ? selectedYear : years[0]!;
  const net = extras.nets.find((candidate) => candidate.year === activeYear)!;
  const subjects = Object.keys(NET_SUBJECT_LABEL_KEYS).flatMap((subject) => {
    const value = net.nets[subject as ProgramNetSubject];
    return value === undefined ? [] : [{ subject: subject as ProgramNetSubject, value }];
  });

  return (
    <Card>
      <SectionTitle>{t('preference.netsSection')}</SectionTitle>
      <View style={styles.yearChips}>
        {extras.nets.map((candidate) => (
          <Chip
            backgroundColor={candidate.year === activeYear ? colors.brand : colors.surface}
            color={candidate.year === activeYear ? colors.onBrand : colors.label}
            key={candidate.year}
            onPress={() => setSelectedYear(candidate.year)}
            selected={candidate.year === activeYear}
          >
            {String(candidate.year)}
          </Chip>
        ))}
      </View>
      <View style={styles.netSummary}>
        {net.minScore !== null ? (
          <View style={styles.netSummaryItem}>
            <Text style={[typography.caption, { color: colors.secondaryLabel }]}>
              {t('preference.netsBaseScore')}
            </Text>
            <Text style={[typography.headline, { color: colors.brand }]}>
              {formatNumber(net.minScore, language, 2)}
            </Text>
          </View>
        ) : null}
        {net.obp !== null ? (
          <View style={styles.netSummaryItem}>
            <Text style={[typography.caption, { color: colors.secondaryLabel }]}>
              {t('preference.obp')}
            </Text>
            <Text style={[typography.headline, { color: colors.label }]}>
              {formatNumber(net.obp, language, 2)}
            </Text>
          </View>
        ) : null}
        {net.coefficient !== null ? (
          <View style={styles.netSummaryItem}>
            <Text style={[typography.caption, { color: colors.secondaryLabel }]}>
              {t('preference.obpCoefficient')}
            </Text>
            <Text style={[typography.headline, { color: colors.label }]}>
              {formatNumber(net.coefficient, language, 2)}
            </Text>
          </View>
        ) : null}
      </View>
      {subjects.map(({ subject, value }) => (
        <View key={subject} style={[styles.tableRow, { borderTopColor: colors.separator }]}>
          <Text style={[typography.footnote, styles.categoryName, { color: colors.label }]}>
            {t(NET_SUBJECT_LABEL_KEYS[subject])}
          </Text>
          <Text style={[typography.footnote, styles.tableCell, { color: colors.label }]}>
            {formatNumber(value, language, 2)}
          </Text>
        </View>
      ))}
      <Footnote>{t('preference.netsNotice')}</Footnote>
    </Card>
  );
}

/** Official placement conditions with their full published texts (code-only when the
 * source publishes no text for a code). */
export function ProgramConditionsCard({ extras }: { extras: ProgramExtras }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!extras.conditions.length) return null;
  return (
    <Card>
      <SectionTitle>{t('preference.conditionsSection')}</SectionTitle>
      {extras.conditions.map((condition) => (
        <View
          key={condition.code}
          style={[styles.conditionRow, { borderTopColor: colors.separator }]}
        >
          <Text style={[typography.headline, { color: colors.label }]}>
            {t('preference.conditionCode', { code: condition.code })}
          </Text>
          <Text
            selectable
            style={[typography.footnote, { color: condition.text ? colors.label : colors.secondaryLabel }]}
          >
            {condition.text ?? t('preference.conditionTextUnavailable')}
          </Text>
        </View>
      ))}
    </Card>
  );
}

/** Öğretim elemanları: the official academic staff headcounts. */
export function ProgramStaffCard({
  extras,
  language,
}: {
  extras: ProgramExtras;
  language: 'tr' | 'en';
}) {
  const { t } = useTranslation();
  if (!extras.staff) return null;
  const rows = [
    { key: 'professor', label: t('preference.staffProfessor'), value: extras.staff.professor },
    { key: 'docent', label: t('preference.staffDocent'), value: extras.staff.docent },
    {
      key: 'doctorFaculty',
      label: t('preference.staffDoctorFaculty'),
      value: extras.staff.doctorFaculty,
    },
    { key: 'lecturer', label: t('preference.staffLecturer'), value: extras.staff.lecturer },
    {
      key: 'researchAssistant',
      label: t('preference.staffResearchAssistant'),
      value: extras.staff.researchAssistant,
    },
  ].filter((row) => row.value !== null);
  if (!rows.length) return null;
  return (
    <Card>
      <SectionTitle>{t('preference.staffSection')}</SectionTitle>
      {rows.map((row) => (
        <InfoRow key={row.key} label={row.label} value={formatNumber(row.value!, language, 0)} />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: { flexBasis: '38%', flexShrink: 0 },
  infoValue: { flex: 1, textAlign: 'right' },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  categoryName: { flex: 1, minWidth: 0, paddingRight: 8 },
  tableCell: { width: 84, textAlign: 'right' },
  yearChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  netSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginBottom: 10 },
  netSummaryItem: { gap: 2 },
  conditionRow: {
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

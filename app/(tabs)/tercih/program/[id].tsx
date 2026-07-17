import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AppHeader,
  Button,
  Card,
  Chip,
  EmptyState,
  Footnote,
  Screen,
  SectionTitle,
} from '@/components/ui';
import {
  ProgramConditionsCard,
  ProgramFactsCard,
  ProgramNetsCard,
  ProgramStaffCard,
  QuotaCategoriesCard,
} from '@/features/programs/ProgramExtrasCards';
import { useProgram, useProgramExtras } from '@/features/programs/usePrograms';
import {
  programScholarshipLabelKey,
  programScoreTypeChipLabel,
  programTypeLabelKey,
} from '@/features/programs/labels';
import { useAppData } from '@/providers/AppDataProvider';
import { useTheme } from '@/theme/useTheme';
import { formatNumber } from '@/utils/format';

async function openProgramSource(source: string) {
  const url = new URL(source);
  const host = url.hostname.toLocaleLowerCase('en-US');
  if (
    url.protocol !== 'https:' ||
    (host !== 'yok.gov.tr' && !host.endsWith('.yok.gov.tr')) ||
    url.username ||
    url.password
  ) {
    throw new Error('Unsafe program source URL');
  }
  await WebBrowser.openBrowserAsync(url.href);
}

// The wizard API exposes 4 years per program today; the pager already scales to the
// full 2018+ archive if a deeper official source is wired later.
const YEARS_PER_PAGE = 3;

export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { program, loading, error, retry } = useProgram(id);
  const { extras } = useProgramExtras(id);
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const { favorites, setFavorite } = useAppData();
  const language = i18n.language === 'en' ? 'en' : 'tr';
  // Chronological pages anchored at the OLDEST year (18-19-20 | 21-22-23 | 24-25-…):
  // future years extend the LAST page instead of reshuffling every group. The pager
  // opens on that newest page; MAX_SAFE_INTEGER simply clamps to it below.
  const [yearPage, setYearPage] = useState(Number.MAX_SAFE_INTEGER);
  const sortedYears = useMemo(
    () => [...(program?.years ?? [])].sort((a, b) => a.year - b.year),
    [program?.years],
  );
  if (loading) {
    return (
      <Screen>
        <AppHeader back title={t('preference.programs')} />
        <ActivityIndicator color={colors.brand} size="large" style={styles.loading} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen>
        <AppHeader back title={t('preference.programs')} />
        <EmptyState
          action={{ title: t('common.retry'), onPress: retry }}
          body={t('preference.programLoadFailed')}
          icon="error-outline"
          title={t('preference.programs')}
        />
      </Screen>
    );
  }
  if (!program) {
    return (
      <Screen>
        <EmptyState
          body={t('preference.noPrograms')}
          icon="school"
          title={t('preference.programs')}
        />
      </Screen>
    );
  }
  const favorite = favorites.includes(program.id);
  // Captured as a const so the narrowed non-null type survives into the press callback;
  // publishable rows always carry a source today, but the schema honestly allows null.
  const source = program.source;
  const totalYearPages = Math.max(1, Math.ceil(sortedYears.length / YEARS_PER_PAGE));
  // Clamped instead of reset-on-change so a pack refresh can never strand the pager.
  const currentYearPage = Math.min(yearPage, totalYearPages - 1);
  const visibleYears = sortedYears.slice(
    currentYearPage * YEARS_PER_PAGE,
    currentYearPage * YEARS_PER_PAGE + YEARS_PER_PAGE,
  );
  return (
    <Screen>
      <AppHeader back title={program.name[language]} subtitle={program.university[language]} />
      <View style={styles.chips}>
        <Chip backgroundColor={colors.brandSoft} color={colors.brand}>
          {programScoreTypeChipLabel(program.scoreType, language)}
        </Chip>
        {program.city ? <Chip>{program.city[language]}</Chip> : null}
        <Chip>{t(programTypeLabelKey(program.type))}</Chip>
        {program.scholarship ? (
          <Chip>{t(programScholarshipLabelKey(program.scholarship))}</Chip>
        ) : null}
        {program.language ? <Chip>{program.language[language]}</Chip> : null}
      </View>
      {program.scoreType === 'yetenek' ? (
        <Card>
          <View style={styles.sourceRow}>
            <MaterialIcons color={colors.brand} name="info-outline" size={24} />
            <View style={styles.grow}>
              <Text style={[typography.headline, { color: colors.label }]}>
                {t('preference.talentExam')}
              </Text>
              <Footnote>{t('preference.talentExamNotice')}</Footnote>
            </View>
          </View>
        </Card>
      ) : null}
      <Button
        icon={favorite ? 'star' : 'star-border'}
        onPress={() =>
          void setFavorite(program.id, !favorite).catch(() =>
            Alert.alert(t('preference.programs'), t('preference.favoriteSaveFailed')),
          )
        }
        title={favorite ? t('preference.unfavorite') : t('preference.favorite')}
        variant={favorite ? 'secondary' : 'primary'}
      />
      {/* Attribution stays above the fold: the detail cards push a bottom card out of
          sight, and the YÖK Atlas credit must not depend on scrolling. */}
      <View style={styles.sourceLine}>
        <MaterialIcons color={colors.brand} name="verified" size={16} />
        <Text
          numberOfLines={1}
          style={[typography.footnote, styles.grow, { color: colors.label, fontWeight: '700' }]}
        >
          {t('preference.attribution')}
        </Text>
        {source ? (
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() =>
              void openProgramSource(source).catch(() =>
                Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
              )
            }
          >
            <Text style={[typography.footnote, { color: colors.brand, fontWeight: '600' }]}>
              {t('common.officialSource')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {extras ? <ProgramFactsCard extras={extras} language={language} /> : null}
      {extras ? <QuotaCategoriesCard extras={extras} language={language} /> : null}
      <Card>
        <SectionTitle
          action={
            totalYearPages > 1 ? (
              <View style={styles.yearsPager}>
                <Pressable
                  accessibilityLabel={t('preference.olderYears')}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: currentYearPage === 0 }}
                  disabled={currentYearPage === 0}
                  hitSlop={8}
                  onPress={() => setYearPage(currentYearPage - 1)}
                >
                  <MaterialIcons
                    color={currentYearPage === 0 ? colors.separator : colors.brand}
                    name="chevron-left"
                    size={28}
                  />
                </Pressable>
                <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                  {visibleYears[0]?.year}–{visibleYears[visibleYears.length - 1]?.year}
                </Text>
                <Pressable
                  accessibilityLabel={t('preference.newerYears')}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: currentYearPage >= totalYearPages - 1 }}
                  disabled={currentYearPage >= totalYearPages - 1}
                  hitSlop={8}
                  onPress={() => setYearPage(currentYearPage + 1)}
                >
                  <MaterialIcons
                    color={
                      currentYearPage >= totalYearPages - 1 ? colors.separator : colors.brand
                    }
                    name="chevron-right"
                    size={28}
                  />
                </Pressable>
              </View>
            ) : undefined
          }
        >
          {t('preference.years')}
        </SectionTitle>
        {visibleYears.map((year) => (
            <View key={year.year} style={[styles.yearRow, { borderTopColor: colors.separator }]}>
              <Text
                numberOfLines={1}
                style={[typography.headline, { color: colors.label, minWidth: 52 }]}
              >
                {year.year}
              </Text>
              <View style={styles.grow}>
                {year.minScore === null && year.minRank === null ? (
                  <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                    {t('preference.cutoffPending')}
                  </Text>
                ) : (
                  <>
                    <Text style={[typography.footnote, { color: colors.label }]}>
                      {' '}
                      {year.minScore
                        ? `${formatNumber(year.minScore, language, 1)} ${t('common.points')}`
                        : '—'}
                    </Text>
                    <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                      {year.minRank ? formatNumber(year.minRank, language, 0) : '—'}
                    </Text>
                  </>
                )}
              </View>
              <View style={styles.yearMeta}>
                <Text
                  numberOfLines={1}
                  style={[typography.footnote, { color: colors.secondaryLabel }]}
                >
                  {t('preference.quota')}: {year.quota ?? '—'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[typography.footnote, { color: colors.secondaryLabel }]}
                >
                  {t('preference.placed')}: {year.placed ?? '—'}
                </Text>
              </View>
            </View>
          ))}
      </Card>
      {extras ? <ProgramNetsCard extras={extras} language={language} /> : null}
      {extras ? <ProgramConditionsCard extras={extras} /> : null}
      {extras ? <ProgramStaffCard extras={extras} language={language} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  yearsPager: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  yearMeta: { alignItems: 'flex-end' },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 0 },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  sourceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  loading: { marginTop: 36 },
});

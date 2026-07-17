import { MaterialIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AppHeader,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Footnote,
  ScreenView,
} from '@/components/ui';
import type { Program } from '@/data/content';
import { defaultProgramFilters, type ProgramFilters } from '@/features/programs/filters';
import {
  PROGRAM_SCORE_TYPES,
  programScholarshipLabelKey,
  programScoreTypeChipLabel,
  programTypeLabelKey,
} from '@/features/programs/labels';
import { ProgramFilterSheet } from '@/features/programs/ProgramFilterSheet';
import { useProgramFacets, usePrograms } from '@/features/programs/usePrograms';
import { useAppData } from '@/providers/AppDataProvider';
import { useSettingsStore } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';
import { formatNumber } from '@/utils/format';

export default function ProgramsScreen() {
  const params = useLocalSearchParams<{
    scoreType?: Program['scoreType'];
  }>();
  const { t, i18n } = useTranslation();
  const { colors, radii, typography } = useTheme();
  const router = useRouter();
  const { favorites, setFavorite, reorderFavorites } = useAppData();
  const storedScoreType = useSettingsStore((state) => state.targetScoreType);
  const setStoredScoreType = useSettingsStore((state) => state.setTargetScoreType);
  // Program-browse score type is wider than the settings ScoreType: it also carries
  // 'tyt' (önlisans placement), which deliberately never flows back into settings.
  const [scoreType, setScoreType] = useState<Program['scoreType']>(
    params.scoreType ?? storedScoreType,
  );
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ProgramFilters>(defaultProgramFilters);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const facets = useProgramFacets(language, filterSheetVisible);
  const { programs, loading, loadingMore, error, loadMore, retry } = usePrograms({
    scoreType,
    language,
    search: query,
    city: filters.city,
    instructionLanguage: filters.instructionLanguage,
    type: filters.type === 'all' ? undefined : filters.type,
    scholarship: filters.scholarship === 'all' ? undefined : filters.scholarship,
    favoriteIds: filters.favoritesOnly ? favorites : undefined,
  });
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const activeFilterChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.type !== 'all') {
    const type = filters.type;
    activeFilterChips.push({
      key: 'type',
      label: t(programTypeLabelKey(type)),
      onRemove: () => setFilters((current) => ({ ...current, type: 'all' })),
    });
  }
  if (filters.scholarship !== 'all') {
    const scholarship = filters.scholarship;
    activeFilterChips.push({
      key: 'scholarship',
      label: t(programScholarshipLabelKey(scholarship)),
      onRemove: () => setFilters((current) => ({ ...current, scholarship: 'all' })),
    });
  }
  if (filters.city) {
    activeFilterChips.push({
      key: 'city',
      label: filters.city,
      onRemove: () => setFilters((current) => ({ ...current, city: null })),
    });
  }
  if (filters.instructionLanguage) {
    activeFilterChips.push({
      key: 'instructionLanguage',
      label: filters.instructionLanguage,
      onRemove: () => setFilters((current) => ({ ...current, instructionLanguage: null })),
    });
  }
  if (filters.favoritesOnly) {
    activeFilterChips.push({
      key: 'favoritesOnly',
      label: t('preference.favoritesOnly'),
      onRemove: () => setFilters((current) => ({ ...current, favoritesOnly: false })),
    });
  }
  // Chip list is the single source of "which filters are active"; the badge count derives
  // from it so the two can never drift.
  const activeFilterCount = activeFilterChips.length;

  const moveFavorite = useCallback(
    (id: string, direction: -1 | 1) => {
      const index = favorites.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= favorites.length) return;
      const next = [...favorites];
      [next[index], next[target]] = [next[target]!, next[index]!];
      void reorderFavorites(next).catch(() =>
        Alert.alert(t('preference.programs'), t('preference.favoriteSaveFailed')),
      );
    },
    [favorites, reorderFavorites, t],
  );

  // Stable across search keystrokes: FlashList re-renders every mounted row whenever
  // renderItem's identity changes, and `query` re-renders this screen per keystroke
  // while the actual list data only updates after usePrograms' 250 ms debounce.
  const renderProgram = useCallback(
    ({ item }: { item: Program }) => {
      // The card shows the same year the list is sorted by: the most recent year with a
      // published cutoff. When no year has one yet (e.g. a brand-new program), fall back
      // to the newest year and say the cutoff is pending instead of printing bare dashes.
      let latest = item.years[0];
      let ranked: (typeof item.years)[number] | undefined;
      for (const year of item.years) {
        if (!latest || year.year > latest.year) latest = year;
        if (
          (year.minScore !== null || year.minRank !== null) &&
          (!ranked || year.year > ranked.year)
        ) {
          ranked = year;
        }
      }
      const shown = ranked ?? latest;
      // Occupancy of the displayed year (official quota vs placed). placed can exceed
      // quota via ek yerleştirme/okul birincisi — that still reads as "doldu".
      const occupancy =
        shown && shown.quota !== null && shown.quota > 0 && shown.placed !== null
          ? shown.placed >= shown.quota
            ? ('full' as const)
            : ('notFull' as const)
          : null;
      const favorite = favoriteSet.has(item.id);
      return (
        <Pressable
          accessibilityHint={t('preference.openProgram')}
          accessibilityRole="button"
          onPress={() => router.push(`/tercih/program/${item.id}`)}
        >
          <Card>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text numberOfLines={2} style={[typography.headline, { color: colors.label }]}>
                  {item.name[language]}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[typography.footnote, { color: colors.secondaryLabel }]}
                >
                  {item.university[language]}
                  {item.city ? ` · ${item.city[language]}` : ''} ·{' '}
                  {t(programTypeLabelKey(item.type))}
                  {item.scholarship ? ` · ${t(programScholarshipLabelKey(item.scholarship))}` : ''}
                  {item.language ? ` · ${item.language[language]}` : ''}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[typography.footnote, { color: colors.secondaryLabel, marginTop: 4 }]}
                >
                  {(ranked ?? latest)?.year ?? '—'}:{' '}
                  {ranked ? (
                    <Text style={{ color: colors.label, fontWeight: '700' }}>
                      {ranked.minScore
                        ? `${formatNumber(ranked.minScore, language, 1)} ${t('common.points')}`
                        : '—'}{' '}
                      · {ranked.minRank ? formatNumber(ranked.minRank, language, 0) : '—'}
                    </Text>
                  ) : (
                    <Text style={{ color: colors.label }}>{t('preference.cutoffPending')}</Text>
                  )}
                  {occupancy ? (
                    <Text
                      style={{
                        color: occupancy === 'full' ? colors.secondaryLabel : colors.brand,
                      }}
                    >
                      {' '}
                      ·{' '}
                      {occupancy === 'full'
                        ? t('preference.occupancyFull')
                        : t('preference.occupancyNotFull')}
                    </Text>
                  ) : null}
                </Text>
              </View>
              <View style={styles.actions}>
                <Pressable
                  accessibilityLabel={
                    favorite ? t('preference.unfavorite') : t('preference.favorite')
                  }
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    void setFavorite(item.id, !favorite).catch(() =>
                      Alert.alert(t('preference.programs'), t('preference.favoriteSaveFailed')),
                    );
                  }}
                  style={styles.star}
                >
                  <MaterialIcons
                    color={favorite ? colors.warning : colors.secondaryLabel}
                    name={favorite ? 'star' : 'star-border'}
                    size={25}
                  />
                </Pressable>
                {filters.favoritesOnly ? (
                  <View style={styles.reorder}>
                    <Pressable
                      accessibilityLabel={t('common.moveUp')}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => moveFavorite(item.id, -1)}
                    >
                      <MaterialIcons
                        color={colors.secondaryLabel}
                        name="keyboard-arrow-up"
                        size={24}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={t('common.moveDown')}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => moveFavorite(item.id, 1)}
                    >
                      <MaterialIcons
                        color={colors.secondaryLabel}
                        name="keyboard-arrow-down"
                        size={24}
                      />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>
          </Card>
        </Pressable>
      );
    },
    [
      colors,
      favoriteSet,
      filters.favoritesOnly,
      language,
      moveFavorite,
      router,
      setFavorite,
      t,
      typography,
    ],
  );

  return (
    <ScreenView>
      <FlashList
        contentContainerStyle={styles.listContent}
        data={programs}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.brand} size="large" style={styles.loading} />
          ) : error ? (
            <EmptyState
              action={{ title: t('common.retry'), onPress: retry }}
              body={t('preference.programLoadFailed')}
              icon="error-outline"
              title={t('preference.programs')}
            />
          ) : scoreType === 'yetenek' && !query && activeFilterCount === 0 ? (
            // Honest empty state: TABLO 5 is legitimately empty until YÖK Atlas loads
            // each year's kılavuz; the weekly pack refresh picks it up automatically.
            <EmptyState
              body={t('preference.talentDataPending')}
              icon="hourglass-empty"
              title={t('preference.talentExam')}
            />
          ) : (
            <EmptyState
              body={t('preference.sampleData')}
              icon="search-off"
              title={t('preference.noPrograms')}
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.brand} style={styles.loadingMore} />
          ) : error && programs.length > 0 ? (
            <View style={styles.footerError}>
              <Text
                accessibilityLiveRegion="polite"
                style={[typography.footnote, { color: colors.danger }]}
              >
                {t('preference.programLoadFailed')}
              </Text>
              <Button onPress={retry} title={t('common.retry')} variant="secondary" />
            </View>
          ) : null
        }
        ListHeaderComponent={
          <View>
            <AppHeader
              back
              title={t('preference.programs')}
              subtitle={t('preference.officialProgramData')}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
              {PROGRAM_SCORE_TYPES.map((value) => (
                <Chip
                  backgroundColor={scoreType === value ? colors.brand : colors.surface}
                  color={scoreType === value ? colors.onBrand : colors.label}
                  key={value}
                  onPress={() => {
                    setScoreType(value);
                    // 'tyt' (önlisans) and 'yetenek' (talent-exam) are browse modes, not
                    // target-track preferences; writing them into settings would leak
                    // into ayarlar/backup, which only model the four lisans tracks.
                    if (value !== 'tyt' && value !== 'yetenek') setStoredScoreType(value);
                  }}
                  selected={scoreType === value}
                >
                  {programScoreTypeChipLabel(value, language)}
                </Chip>
              ))}
            </ScrollView>
            <View style={styles.searchRow}>
              <Field
                containerStyle={styles.searchField}
                label={t('preference.search')}
                labelHidden
                onChangeText={setQuery}
                value={query}
              />
              <Pressable
                accessibilityLabel={
                  activeFilterCount > 0
                    ? `${t('preference.filterAction')} · ${t('preference.filtersActive', {
                        count: activeFilterCount,
                      })}`
                    : t('preference.filterAction')
                }
                accessibilityRole="button"
                onPress={() => setFilterSheetVisible(true)}
                style={({ pressed }) => [
                  styles.filterButton,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.separator,
                    borderRadius: radii.button,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <MaterialIcons
                  color={activeFilterCount > 0 ? colors.brand : colors.label}
                  name="tune"
                  size={20}
                />
                <Text
                  style={[
                    typography.subhead,
                    styles.filterButtonLabel,
                    { color: activeFilterCount > 0 ? colors.brand : colors.label },
                  ]}
                >
                  {t('preference.filterAction')}
                </Text>
                {activeFilterCount > 0 ? (
                  <View style={[styles.filterBadge, { backgroundColor: colors.brand }]}>
                    <Text style={[typography.caption, { color: colors.onBrand }]}>
                      {activeFilterCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
            {activeFilterChips.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
                {activeFilterChips.map((chip) => (
                  <Chip
                    accessibilityLabel={t('preference.removeFilter', { name: chip.label })}
                    backgroundColor={colors.surface}
                    key={chip.key}
                    onPress={chip.onRemove}
                    selected
                  >
                    {chip.label} ✕
                  </Chip>
                ))}
              </ScrollView>
            ) : null}
            <Footnote>{t('preference.attribution')}</Footnote>
            <View style={{ height: 12 }} />
          </View>
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        renderItem={renderProgram}
      />
      <ProgramFilterSheet
        cities={facets.cities}
        error={facets.error}
        languages={facets.languages}
        loading={facets.loading}
        locale={language}
        onApply={(next) => {
          setFilters(next);
          setFilterSheetVisible(false);
        }}
        onClose={() => setFilterSheetVisible(false)}
        onRetry={facets.retry}
        value={filters}
        visible={filterSheetVisible}
      />
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 132 },
  filters: { marginBottom: 10 },
  // flex-end + matching bottom margin aligns the button with the Field's input box
  // (the Field renders its label above the input inside its own wrapper).
  searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  searchField: { flex: 1, minWidth: 0 },
  filterButton: {
    flexDirection: 'row',
    height: 48,
    paddingHorizontal: 14,
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 14,
  },
  filterButtonLabel: { fontWeight: '600' },
  filterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.66 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  actions: { alignItems: 'flex-end' },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reorder: { flexDirection: 'row', gap: 4 },
  loading: { marginTop: 36 },
  loadingMore: { marginVertical: 18 },
  footerError: { gap: 10, marginVertical: 18 },
});

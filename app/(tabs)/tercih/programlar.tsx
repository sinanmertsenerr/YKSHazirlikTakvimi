import { MaterialIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Card, Chip, EmptyState, Field, Footnote, ScreenView } from '@/components/ui';
import type { Program } from '@/data/content';
import { programScholarshipLabelKey, programTypeLabelKey } from '@/features/programs/labels';
import {
  useProgramCities,
  useProgramLanguages,
  usePrograms,
} from '@/features/programs/usePrograms';
import { useAppData } from '@/providers/AppDataProvider';
import { type ScoreType, useSettingsStore } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';
import { formatNumber } from '@/utils/format';

type TypeFilter = 'all' | Program['type'] | NonNullable<Program['scholarship']> | 'favorite';

export default function ProgramsScreen() {
  const params = useLocalSearchParams<{
    scoreType?: 'say' | 'ea' | 'soz' | 'dil';
  }>();
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const router = useRouter();
  const { favorites, setFavorite, reorderFavorites } = useAppData();
  const storedScoreType = useSettingsStore((state) => state.targetScoreType);
  const setStoredScoreType = useSettingsStore((state) => state.setTargetScoreType);
  const [scoreType, setScoreType] = useState<ScoreType>(params.scoreType ?? storedScoreType);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [city, setCity] = useState<string | null>(null);
  const [instructionLanguage, setInstructionLanguage] = useState<string | null>(null);
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const cities = useProgramCities(language);
  const instructionLanguages = useProgramLanguages(language);
  const typeFilter =
    filter === 'devlet' || filter === 'vakif' || filter === 'kibris' ? filter : undefined;
  const scholarshipFilter =
    filter === 'burslu' || filter === '%25' || filter === '%50' || filter === 'ucretli'
      ? filter
      : undefined;
  const { programs, loading, loadingMore, loadMore } = usePrograms({
    scoreType,
    language,
    search: query,
    city,
    instructionLanguage,
    type: typeFilter,
    scholarship: scholarshipFilter,
    favoriteIds: filter === 'favorite' ? favorites : undefined,
  });

  const moveFavorite = (id: string, direction: -1 | 1) => {
    const index = favorites.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= favorites.length) return;
    const next = [...favorites];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void reorderFavorites(next);
  };

  const renderProgram = ({ item }: { item: Program }) => {
    const latest = [...item.years].sort((a, b) => b.year - a.year)[0];
    const favorite = favorites.includes(item.id);
    return (
      <Pressable
        accessibilityHint={t('preference.openProgram')}
        accessibilityRole="button"
        onPress={() => router.push(`/tercih/program/${item.id}`)}
      >
        <Card>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Text style={[typography.headline, { color: colors.label }]}>
                {item.name[language]}
              </Text>
              <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                {item.university[language]} · {item.city[language]} ·{' '}
                {t(programTypeLabelKey(item.type))}
                {item.scholarship ? ` · ${t(programScholarshipLabelKey(item.scholarship))}` : ''}
                {item.language ? ` · ${item.language[language]}` : ''}
              </Text>
              <Text style={[typography.footnote, { color: colors.secondaryLabel, marginTop: 4 }]}>
                {latest?.year ?? '—'}:{' '}
                <Text style={{ color: colors.label, fontWeight: '700' }}>
                  {latest?.minScore
                    ? `${formatNumber(latest.minScore, language, 1)} ${t('common.points')}`
                    : '—'}{' '}
                  · {latest?.minRank ? formatNumber(latest.minRank, language, 0) : '—'}
                </Text>
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
                  void setFavorite(item.id, !favorite);
                }}
                style={styles.star}
              >
                <MaterialIcons
                  color={favorite ? colors.warning : colors.secondaryLabel}
                  name={favorite ? 'star' : 'star-border'}
                  size={25}
                />
              </Pressable>
              {filter === 'favorite' ? (
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
  };

  return (
    <ScreenView>
      <FlashList
        contentContainerStyle={styles.listContent}
        data={programs}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.brand} size="large" style={styles.loading} />
          ) : (
            <EmptyState
              body={t('preference.sampleData')}
              icon="search-off"
              title={t('preference.noPrograms')}
            />
          )
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={colors.brand} style={styles.loadingMore} /> : null
        }
        ListHeaderComponent={
          <View>
            <AppHeader
              back
              title={t('preference.programs')}
              subtitle={t('preference.officialProgramData')}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
              {(['say', 'ea', 'soz', 'dil'] as const).map((value) => (
                <Chip
                  backgroundColor={scoreType === value ? colors.brand : colors.surface}
                  color={scoreType === value ? colors.onBrand : colors.label}
                  key={value}
                  onPress={() => {
                    setScoreType(value);
                    setStoredScoreType(value);
                  }}
                  selected={scoreType === value}
                >
                  {value === 'soz'
                    ? 'SÖZ'
                    : value === 'dil'
                      ? language === 'en'
                        ? 'LANG'
                        : 'DİL'
                      : value.toUpperCase()}
                </Chip>
              ))}
            </ScrollView>
            <Field label={t('preference.search')} onChangeText={setQuery} value={query} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
              {(
                [
                  'all',
                  'devlet',
                  'vakif',
                  'kibris',
                  'burslu',
                  '%25',
                  '%50',
                  'ucretli',
                  'favorite',
                ] as const
              ).map((value) => (
                <Chip
                  backgroundColor={filter === value ? colors.brand : colors.surface}
                  color={filter === value ? colors.onBrand : colors.label}
                  key={value}
                  onPress={() => setFilter(value)}
                  selected={filter === value}
                >
                  {value === 'all'
                    ? t('common.all')
                    : value === 'favorite'
                      ? '★'
                      : value === 'devlet' || value === 'vakif' || value === 'kibris'
                        ? t(programTypeLabelKey(value))
                        : t(programScholarshipLabelKey(value))}
                </Chip>
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
              <Chip onPress={() => setCity(null)} selected={!city}>
                {t('preference.city')}: {t('common.all')}
              </Chip>
              {cities.map((item) => (
                <Chip key={item} onPress={() => setCity(item)} selected={city === item}>
                  {item}
                </Chip>
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
              <Chip onPress={() => setInstructionLanguage(null)} selected={!instructionLanguage}>
                {t('preference.instructionLanguage')}: {t('common.all')}
              </Chip>
              {instructionLanguages.map((item) => (
                <Chip
                  key={item}
                  onPress={() => setInstructionLanguage(item)}
                  selected={instructionLanguage === item}
                >
                  {item}
                </Chip>
              ))}
            </ScrollView>
            <Footnote>{t('preference.attribution')}</Footnote>
            <View style={{ height: 12 }} />
          </View>
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        renderItem={renderProgram}
      />
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 132 },
  filters: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  actions: { alignItems: 'flex-end' },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reorder: { flexDirection: 'row', gap: 4 },
  loading: { marginTop: 36 },
  loadingMore: { marginVertical: 18 },
});

import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Chip, Field } from '@/components/ui';
import { Sheet } from '@/components/sheet';
import type { Program } from '@/data/content';
import { useTheme } from '@/theme/useTheme';

import { defaultProgramFilters, type ProgramFilters } from './filters';
import {
  PROGRAM_SCHOLARSHIP_LABEL_KEYS,
  PROGRAM_TYPE_LABEL_KEYS,
  programScholarshipLabelKey,
  programTypeLabelKey,
} from './labels';

// Object.keys erases key types; the label maps are `satisfies Record<...>`, so the
// casts restore exactly what the compiler already verified.
const TYPE_OPTIONS: readonly ProgramFilters['type'][] = [
  'all',
  ...(Object.keys(PROGRAM_TYPE_LABEL_KEYS) as Program['type'][]),
];
const SCHOLARSHIP_OPTIONS: readonly ProgramFilters['scholarship'][] = [
  'all',
  ...(Object.keys(PROGRAM_SCHOLARSHIP_LABEL_KEYS) as NonNullable<Program['scholarship']>[]),
];

type PickerPage = 'city' | 'language';

type ProgramFilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: ProgramFilters) => void;
  value: ProgramFilters;
  cities: string[];
  languages: string[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  locale: 'tr' | 'en';
};

// A fresh key per open re-initializes draft/page/search from the current props
// without a state-sync effect. Keying on the open count (not on `visible`) keeps
// the same instance mounted through dismissal, so the close animation still plays.
export function ProgramFilterSheet(props: ProgramFilterSheetProps) {
  const [openCount, setOpenCount] = useState(0);
  const [wasVisible, setWasVisible] = useState(props.visible);
  if (props.visible !== wasVisible) {
    setWasVisible(props.visible);
    if (props.visible) setOpenCount((count) => count + 1);
  }
  return <ProgramFilterSheetContent key={openCount} {...props} />;
}

function ProgramFilterSheetContent({
  visible,
  onClose,
  onApply,
  value,
  cities,
  languages,
  loading,
  error,
  onRetry,
  locale,
}: ProgramFilterSheetProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [draft, setDraft] = useState<ProgramFilters>(value);
  const [page, setPage] = useState<'main' | PickerPage>('main');
  const [search, setSearch] = useState('');

  const pickerOptions = page === 'city' ? cities : languages;
  const pickerSelected = page === 'city' ? draft.city : draft.instructionLanguage;
  const facetsUnavailable = loading || Boolean(error);
  const filteredOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(locale);
    if (!needle) return pickerOptions;
    return pickerOptions.filter((option) => option.toLocaleLowerCase(locale).includes(needle));
  }, [locale, pickerOptions, search]);

  const openPicker = (next: PickerPage) => {
    setSearch('');
    setPage(next);
  };
  const pickOption = (option: string | null) => {
    setDraft((current) =>
      page === 'city' ? { ...current, city: option } : { ...current, instructionLanguage: option },
    );
    setPage('main');
  };

  const renderChips = <T extends string>(
    options: readonly T[],
    selected: T,
    label: (option: T) => string,
    onSelect: (option: T) => void,
  ) => (
    <View style={styles.chipsWrap}>
      {options.map((option) => (
        <Chip
          backgroundColor={selected === option ? colors.brand : colors.surface}
          color={selected === option ? colors.onBrand : colors.label}
          key={option}
          onPress={() => onSelect(option)}
          selected={selected === option}
        >
          {label(option)}
        </Chip>
      ))}
    </View>
  );

  const pickerRow = ({ item }: { item: string | null }) => {
    const selected = item === pickerSelected;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => pickOption(item)}
        style={({ pressed }) => [
          styles.pickerRow,
          { borderBottomColor: colors.separator },
          pressed && styles.pressed,
        ]}
      >
        <Text numberOfLines={1} style={[typography.body, styles.rowLabel, { color: colors.label }]}>
          {item ?? t('common.all')}
        </Text>
        {selected ? <MaterialIcons color={colors.brand} name="check" size={22} /> : null}
      </Pressable>
    );
  };

  return (
    <Sheet
      footer={
        page === 'main' ? (
          <View style={styles.footer}>
            <Button
              onPress={() => setDraft(defaultProgramFilters)}
              style={styles.footerButton}
              title={t('common.clear')}
              variant="secondary"
            />
            <Button
              onPress={() => onApply(draft)}
              style={styles.footerButton}
              title={t('common.apply')}
            />
          </View>
        ) : undefined
      }
      headerLeft={
        page === 'main' ? undefined : (
          <Pressable
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => setPage('main')}
            style={styles.back}
          >
            <MaterialIcons color={colors.brand} name="arrow-back-ios-new" size={20} />
          </Pressable>
        )
      }
      onClose={onClose}
      onRequestClose={page === 'main' ? onClose : () => setPage('main')}
      title={
        page === 'main'
          ? t('preference.filters')
          : page === 'city'
            ? t('preference.city')
            : t('preference.instructionLanguage')
      }
      visible={visible}
    >
      {page === 'main' ? (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text
            style={[typography.footnote, styles.sectionLabel, { color: colors.secondaryLabel }]}
          >
            {t('preference.universityType')}
          </Text>
          {renderChips(
            TYPE_OPTIONS,
            draft.type,
            (option) => (option === 'all' ? t('common.all') : t(programTypeLabelKey(option))),
            (option) => setDraft((current) => ({ ...current, type: option })),
          )}
          <Text
            style={[typography.footnote, styles.sectionLabel, { color: colors.secondaryLabel }]}
          >
            {t('preference.scholarshipStatus')}
          </Text>
          {renderChips(
            SCHOLARSHIP_OPTIONS,
            draft.scholarship,
            (option) =>
              option === 'all' ? t('common.all') : t(programScholarshipLabelKey(option)),
            (option) => setDraft((current) => ({ ...current, scholarship: option })),
          )}
          {error ? (
            <View style={styles.facetError}>
              <Text
                accessibilityLiveRegion="polite"
                style={[typography.footnote, { color: colors.danger }]}
              >
                {t('preference.filterLoadFailed')}
              </Text>
              <Button onPress={onRetry} title={t('common.retry')} variant="secondary" />
            </View>
          ) : null}
          <Card style={styles.rowsCard}>
            <Pressable
              accessibilityState={{ disabled: facetsUnavailable }}
              accessibilityRole="button"
              disabled={facetsUnavailable}
              onPress={() => openPicker('city')}
              style={({ pressed }) => [
                styles.settingRow,
                { borderBottomColor: colors.separator },
                pressed && styles.pressed,
                facetsUnavailable && styles.disabled,
              ]}
            >
              <Text style={[typography.body, styles.rowLabel, { color: colors.label }]}>
                {t('preference.city')}
              </Text>
              <Text
                numberOfLines={1}
                style={[typography.body, styles.rowValue, { color: colors.secondaryLabel }]}
              >
                {loading ? t('common.loading') : (draft.city ?? t('common.all'))}
              </Text>
              {loading ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <MaterialIcons color={colors.secondaryLabel} name="chevron-right" size={22} />
              )}
            </Pressable>
            <Pressable
              accessibilityState={{ disabled: facetsUnavailable }}
              accessibilityRole="button"
              disabled={facetsUnavailable}
              onPress={() => openPicker('language')}
              style={({ pressed }) => [
                styles.settingRow,
                { borderBottomColor: colors.separator },
                pressed && styles.pressed,
                facetsUnavailable && styles.disabled,
              ]}
            >
              <Text style={[typography.body, styles.rowLabel, { color: colors.label }]}>
                {t('preference.instructionLanguage')}
              </Text>
              <Text
                numberOfLines={1}
                style={[typography.body, styles.rowValue, { color: colors.secondaryLabel }]}
              >
                {loading ? t('common.loading') : (draft.instructionLanguage ?? t('common.all'))}
              </Text>
              {loading ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <MaterialIcons color={colors.secondaryLabel} name="chevron-right" size={22} />
              )}
            </Pressable>
            <View style={[styles.settingRow, styles.lastRow]}>
              <Text style={[typography.body, styles.rowLabel, { color: colors.label }]}>
                {t('preference.favoritesOnly')}
              </Text>
              <Switch
                accessibilityLabel={t('preference.favoritesOnly')}
                onValueChange={(favoritesOnly) =>
                  setDraft((current) => ({ ...current, favoritesOnly }))
                }
                trackColor={{ true: colors.brand }}
                value={draft.favoritesOnly}
              />
            </View>
          </Card>
        </ScrollView>
      ) : (
        <View style={[styles.picker, { height: windowHeight * 0.6 }]}>
          <Field
            autoCorrect={false}
            containerStyle={styles.pickerSearch}
            label={page === 'city' ? t('preference.searchCity') : t('preference.searchLanguage')}
            labelHidden
            onChangeText={setSearch}
            value={search}
          />
          <FlatList
            data={[null, ...filteredOptions]}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item ?? '__all__'}
            renderItem={pickerRow}
            style={styles.pickerList}
          />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontWeight: '600', marginBottom: 8 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  rowsCard: { padding: 0, marginBottom: 4 },
  facetError: { gap: 10, marginBottom: 12 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: { borderBottomWidth: 0 },
  rowLabel: { flex: 1, minWidth: 0 },
  rowValue: { flexShrink: 1, minWidth: 0, maxWidth: '50%' },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  footerButton: { flex: 1 },
  // Concrete height so the virtualized list stays bounded; shrinks under the keyboard.
  picker: { flexShrink: 1, minHeight: 0 },
  pickerSearch: { marginBottom: 8 },
  pickerList: { flex: 1, minHeight: 0 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.66 },
  disabled: { opacity: 0.5 },
});

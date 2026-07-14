import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import { useProgram } from '@/features/programs/usePrograms';
import { programScholarshipLabelKey, programTypeLabelKey } from '@/features/programs/labels';
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

export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { program, loading } = useProgram(id);
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const { favorites, setFavorite } = useAppData();
  const language = i18n.language === 'en' ? 'en' : 'tr';
  if (loading) {
    return (
      <Screen>
        <AppHeader back title={t('preference.programs')} />
        <ActivityIndicator color={colors.brand} size="large" style={styles.loading} />
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
  return (
    <Screen>
      <AppHeader back title={program.name[language]} subtitle={program.university[language]} />
      <View style={styles.chips}>
        <Chip backgroundColor={colors.brandSoft} color={colors.brand}>
          {program.scoreType.toUpperCase()}
        </Chip>
        <Chip>{program.city[language]}</Chip>
        <Chip>{t(programTypeLabelKey(program.type))}</Chip>
        {program.scholarship ? (
          <Chip>{t(programScholarshipLabelKey(program.scholarship))}</Chip>
        ) : null}
        {program.language ? <Chip>{program.language[language]}</Chip> : null}
      </View>
      <Button
        icon={favorite ? 'star' : 'star-border'}
        onPress={() => void setFavorite(program.id, !favorite)}
        title={favorite ? t('preference.unfavorite') : t('preference.favorite')}
        variant={favorite ? 'secondary' : 'primary'}
      />
      <View style={{ height: 12 }} />
      <Card>
        <SectionTitle>{t('preference.years')}</SectionTitle>
        {[...program.years]
          .sort((a, b) => b.year - a.year)
          .map((year) => (
            <View key={year.year} style={[styles.yearRow, { borderTopColor: colors.separator }]}>
              <Text style={[typography.headline, { color: colors.label, width: 52 }]}>
                {year.year}
              </Text>
              <View style={styles.grow}>
                <Text style={[typography.footnote, { color: colors.label }]}>
                  {' '}
                  {year.minScore
                    ? `${formatNumber(year.minScore, language, 1)} ${t('common.points')}`
                    : '—'}
                </Text>
                <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                  {year.minRank ? formatNumber(year.minRank, language, 0) : '—'}
                </Text>
              </View>
              <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                {t('preference.quota')}: {year.quota ?? '—'}
              </Text>
            </View>
          ))}
      </Card>
      <Card>
        <View style={styles.sourceRow}>
          <MaterialIcons color={colors.brand} name="verified" size={24} />
          <View style={styles.grow}>
            <Text style={[typography.headline, { color: colors.label }]}>
              {t('preference.attribution')}
            </Text>
            <Footnote>{t('preference.officialProgramData')}</Footnote>
          </View>
        </View>
        <Button
          onPress={() => void openProgramSource(program.source!)}
          title={t('common.officialSource')}
          variant="secondary"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 0 },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  loading: { marginTop: 36 },
});

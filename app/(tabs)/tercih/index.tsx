import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Button, Card, Footnote, Screen, SectionTitle } from '@/components/ui';
import { useSettingsStore } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';

/**
 * ÖSYM does not publish stable "points per net" coefficients. A cohort's mean and standard
 * deviation are part of the annual calculation, so bundled synthetic coefficients must never be
 * presented as a factual score or rank. The official YÖK Atlas browser remains available without
 * inventing an estimate.
 */
export default function PreferenceScreen() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const router = useRouter();
  const scoreType = useSettingsStore((state) => state.targetScoreType);

  return (
    <Screen>
      <AppHeader title={t('preference.title')} subtitle={t('preference.officialSubtitle')} />
      <Card style={styles.card}>
        <SectionTitle>{t('preference.calculatorUnavailableTitle')}</SectionTitle>
        <Text style={[typography.body, { color: colors.label }]}>
          {t('preference.calculatorUnavailable')}
        </Text>
        <Footnote color={colors.secondaryLabel}>{t('preference.noSyntheticResults')}</Footnote>
      </Card>
      <Button
        icon="school"
        onPress={() =>
          router.push({
            pathname: '/tercih/programlar',
            params: { scoreType },
          })
        }
        title={t('preference.browseOfficialPrograms')}
      />
      <Footnote color={colors.warningText}>{t('preference.warning')}</Footnote>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
});

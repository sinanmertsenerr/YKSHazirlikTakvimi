import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { YearBarChart } from '@/components/charts';
import { AppHeader, Card, Chip, EmptyState, Footnote, Screen, SectionTitle } from '@/components/ui';
import {
  findOfficialTopicGroup,
  findSubject,
  topicGroupStatisticsPack,
  useContentRevisionStore,
} from '@/data/content';
import { useTheme } from '@/theme/useTheme';
import { formatInstantDate } from '@/utils/format';
import { allowedOgmHttpsUrl } from '@/utils/officialUrls';

export default function OfficialTopicGroupDetailScreen() {
  const { grupId } = useLocalSearchParams<{ grupId: string }>();
  useContentRevisionStore((state) => state.revision);
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const statistics = topicGroupStatisticsPack;
  const group = findOfficialTopicGroup(grupId);

  if (statistics.availability !== 'available' || !group) {
    return (
      <Screen>
        <EmptyState
          body={t('topics.officialGroupsPending')}
          icon="hourglass-empty"
          title={t('topics.officialGroups')}
        />
      </Screen>
    );
  }

  const source = statistics.sources.find((candidate) => candidate.key === group.sourceKey);
  const sourceUrl = allowedOgmHttpsUrl(source?.resolverUrl);
  const subject = findSubject(group.displaySubjectId);
  const targetYear = subject?.topics[0]?.yearlyStats.at(-1)?.year;
  const openSource = async () => {
    if (!sourceUrl) throw new Error('Unsafe external URL');
    await WebBrowser.openBrowserAsync(sourceUrl);
  };

  return (
    <Screen>
      <AppHeader back subtitle={t('topics.officialGroupDetail')} title={group.sourceLabelTr} />
      <View style={styles.chips}>
        <Chip backgroundColor={colors.brandSoft} color={colors.brand}>
          {group.exam.toUpperCase()}
        </Chip>
        <Chip backgroundColor={colors.surfaceSecondary} color={colors.secondaryLabel}>
          MEB OGM
        </Chip>
      </View>

      <Card>
        <SectionTitle>{t('topics.yearlyQuestions')}</SectionTitle>
        <YearBarChart
          data={group.yearlyCounts.map((row, index) => ({
            index,
            value: row.count,
            label: `'${String(row.year).slice(-2)}`,
          }))}
        />
        <Footnote>
          {t('topics.officialTotal', {
            count: group.total,
            first: statistics.coverage.firstYear,
            last: statistics.coverage.lastYear,
          })}
        </Footnote>
      </Card>

      {targetYear && targetYear > statistics.coverage.lastYear ? (
        <Card>
          <Footnote>{t('topics.unpublishedYear', { year: targetYear })}</Footnote>
        </Card>
      ) : null}

      {group.countingPolicy === 'alternative-included' ? (
        <Card style={[styles.notice, { borderLeftColor: colors.warning }]}>
          <Footnote color={colors.warningText}>{t('topics.alternativeIncludedNotice')}</Footnote>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t('common.source')}</SectionTitle>
        <Text style={[typography.footnote, { color: colors.label }]}>
          {t('topics.officialGroupSource')}
        </Text>
        <Footnote>{t('topics.sourcePage', { page: group.physicalPage })}</Footnote>
        <Footnote>
          {t('topics.verifiedOn', {
            date: formatInstantDate(statistics.verifiedAt, i18n.language),
          })}
        </Footnote>
        {sourceUrl ? (
          <Pressable
            accessibilityLabel={t('common.officialSource')}
            accessibilityRole="link"
            onPress={() =>
              void openSource().catch(() =>
                Alert.alert(t('common.externalLink'), t('common.retry')),
              )
            }
            style={styles.sourceLink}
          >
            <MaterialIcons color={colors.brand} name="open-in-new" size={20} />
            <Text style={[typography.headline, { color: colors.brand }]}>
              {t('common.officialSource')}
            </Text>
          </Pressable>
        ) : null}
      </Card>

      <Card style={[styles.notice, { borderLeftColor: colors.warning }]}>
        <Footnote color={colors.warningText}>{t('topics.officialGroupsNotice')}</Footnote>
        {i18n.language === 'en' ? <Footnote>{t('topics.sourceOnlyLabel')}</Footnote> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  notice: { borderLeftWidth: 3 },
  sourceLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingTop: 8,
  },
});

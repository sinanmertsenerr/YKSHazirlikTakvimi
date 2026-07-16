import { MaterialIcons } from '@expo/vector-icons';
import { getNetworkStateAsync } from 'expo-network';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  type ListRenderItem,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Card, Chip, EmptyState, Footnote, ScreenView } from '@/components/ui';
import { calendarPack, newsPack, type NewsItem, useContentRevisionStore } from '@/data/content';
import { refreshNews } from '@/features/news/newsCache';
import { useSettingsStore } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';
import {
  daysUntil,
  formatDateOnly,
  localizeEmbeddedDateTokens,
  relativeTime,
} from '@/utils/format';
import { getContentUpdateIssue } from '@/utils/contentUpdateError';
import { allowedOsymHttpsUrl } from '@/utils/officialUrls';

const allowedHosts = new Set([
  'www.osym.gov.tr',
  'osym.gov.tr',
  'www.yok.gov.tr',
  'yok.gov.tr',
  'yokatlas.yok.gov.tr',
]);

async function openAllowed(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname))
    throw new Error('Unsafe URL');
  await WebBrowser.openBrowserAsync(url);
}

function formatCheckTime(value: number, language: 'tr' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  } catch {
    return new Date(value).toISOString();
  }
}

export default function NewsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const [network, setNetwork] = useState<{
    isInternetReachable?: boolean;
    isConnected?: boolean;
  }>({});
  useContentRevisionStore((state) => state.revision);
  const lastPackFailureTs = useSettingsStore((state) => state.lastPackFailureTs);
  const lastPackError = useSettingsStore((state) => state.lastPackError);
  const [refreshing, setRefreshing] = useState(false);
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const offline = network.isInternetReachable === false || network.isConnected === false;
  const contentUpdateIssue = lastPackError ? getContentUpdateIssue(lastPackError) : null;
  const contentUpdateIssueColor =
    contentUpdateIssue?.tone === 'info'
      ? colors.brand
      : contentUpdateIssue?.tone === 'warning'
        ? colors.warningText
        : colors.danger;
  const contentUpdateIssueBackground =
    contentUpdateIssue?.tone === 'info'
      ? colors.brandSoft
      : contentUpdateIssue?.tone === 'warning'
        ? colors.warningSoft
        : colors.surfaceSecondary;
  const items = newsPack.items;
  const upcoming = calendarPack.events
    .filter((event) => daysUntil(event.start) >= 0)
    .sort((left, right) => left.start.localeCompare(right.start));

  useEffect(() => {
    const refreshNetworkState = () => {
      void getNetworkStateAsync()
        .then(setNetwork)
        .catch(() => setNetwork({}));
    };
    refreshNetworkState();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshNetworkState();
    });
    return () => subscription.remove();
  }, []);

  const onRefresh = useCallback(async () => {
    if (offline) {
      Alert.alert(t('news.title'), t('news.offline'));
      return;
    }
    setRefreshing(true);
    try {
      await refreshNews();
    } catch (error) {
      const issue = getContentUpdateIssue(error);
      Alert.alert(t(issue.titleKey), t(issue.messageKey));
    } finally {
      setRefreshing(false);
    }
  }, [offline, t]);

  const renderNewsItem: ListRenderItem<NewsItem> = useCallback(
    ({ item }) => (
      <Pressable
        accessibilityHint={t('common.externalLink')}
        accessibilityRole="link"
        onPress={() =>
          void openAllowed(item.url).catch(() =>
            Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
          )
        }
      >
        <Card>
          <View style={styles.sourceRow}>
            <Chip
              backgroundColor={
                item.source === 'ÖSYM'
                  ? colors.brandSoft
                  : item.source === 'YÖK'
                    ? colors.aytSoft
                    : colors.surfaceSecondary
              }
              color={
                item.source === 'ÖSYM'
                  ? colors.brand
                  : item.source === 'YÖK'
                    ? colors.aytText
                    : colors.label
              }
            >
              {item.source}
            </Chip>
            <Text numberOfLines={1} style={[typography.footnote, { color: colors.secondaryLabel }]}>
              {relativeTime(new Date(item.publishedAt).getTime(), language)}
            </Text>
          </View>
          <Text numberOfLines={2} style={[typography.headline, { color: colors.label }]}>
            {localizeEmbeddedDateTokens(item.title[language], language)}
          </Text>
          <Text
            numberOfLines={3}
            style={[typography.footnote, { color: colors.secondaryLabel, marginTop: 4 }]}
          >
            {localizeEmbeddedDateTokens(item.summary[language], language)}
          </Text>
          {item.sample ? (
            <Footnote color={colors.warningText}>{t('news.sampleData')}</Footnote>
          ) : null}
        </Card>
      </Pressable>
    ),
    [colors, language, t, typography],
  );

  return (
    <ScreenView>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={items}
        initialNumToRender={8}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <EmptyState
            action={{ title: t('news.refresh'), onPress: () => void onRefresh() }}
            body={t('news.noNewsBody')}
            icon="newspaper"
            title={t('news.noNews')}
          />
        }
        ListHeaderComponent={
          <>
            <AppHeader title={t('news.title')} subtitle={t('news.subtitle')} />
            {offline ? (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.offline, { backgroundColor: colors.warning, borderRadius: 12 }]}
              >
                <MaterialIcons color="#111113" name="cloud-off" size={20} />
                <Text
                  style={[
                    typography.footnote,
                    { color: '#111113', flex: 1, minWidth: 0, fontWeight: '700' },
                  ]}
                >
                  {t('news.offline')}
                </Text>
              </View>
            ) : null}
            {contentUpdateIssue &&
            lastPackFailureTs !== null &&
            !(offline && contentUpdateIssue.code === 'connectivity') ? (
              <View
                accessibilityLiveRegion="polite"
                style={[
                  styles.updateIssue,
                  {
                    backgroundColor: contentUpdateIssueBackground,
                    borderColor: contentUpdateIssueColor,
                    borderRadius: 12,
                  },
                ]}
              >
                <MaterialIcons
                  color={contentUpdateIssueColor}
                  name={
                    contentUpdateIssue.tone === 'info'
                      ? 'info-outline'
                      : contentUpdateIssue.tone === 'warning'
                        ? 'cloud-off'
                        : 'error-outline'
                  }
                  size={20}
                />
                <View style={styles.updateIssueText}>
                  <Text
                    style={[
                      typography.footnote,
                      { color: contentUpdateIssueColor, fontWeight: '700' },
                    ]}
                  >
                    {t(contentUpdateIssue.titleKey)}
                  </Text>
                  <Text style={[typography.footnote, { color: colors.label }]}>
                    {t(contentUpdateIssue.messageKey)}
                  </Text>
                  <Text style={[typography.caption, { color: colors.secondaryLabel }]}>
                    {formatCheckTime(lastPackFailureTs, language)}
                  </Text>
                </View>
              </View>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.calendarStrip}
            >
              {upcoming.map((event) => {
                const source = allowedOsymHttpsUrl(event.source);
                const card = (
                  <Card
                    key={event.id}
                    style={[
                      styles.calendarCard,
                      { borderTopColor: event.verified ? colors.brand : colors.warning },
                    ]}
                  >
                    <Text
                      style={[
                        typography.caption,
                        styles.uppercase,
                        { color: event.verified ? colors.brand : colors.warningText },
                      ]}
                    >
                      {t('news.calendar')} {event.approximate ? `· ${t('news.expected')}` : ''}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[typography.headline, styles.calendarTitle, { color: colors.label }]}
                    >
                      {event.title[language]}
                    </Text>
                    <Text
                      adjustsFontSizeToFit
                      numberOfLines={1}
                      style={[typography.footnote, { color: colors.secondaryLabel }]}
                    >
                      {formatDateOnly(event.start, language)}
                      {event.end ? ` – ${formatDateOnly(event.end, language)}` : ''}
                    </Text>
                  </Card>
                );
                return source ? (
                  <Pressable
                    accessibilityHint={t('common.officialSource')}
                    accessibilityRole="link"
                    key={event.id}
                    onPress={() =>
                      void WebBrowser.openBrowserAsync(source).catch(() =>
                        Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
                      )
                    }
                  >
                    {card}
                  </Pressable>
                ) : (
                  card
                );
              })}
            </ScrollView>
          </>
        }
        maxToRenderPerBatch={8}
        refreshControl={
          <RefreshControl
            colors={[colors.brand]}
            onRefresh={() => void onRefresh()}
            refreshing={refreshing}
            tintColor={colors.brand}
          />
        }
        renderItem={renderNewsItem}
        windowSize={7}
      />
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 132 },
  offline: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  updateIssue: {
    alignItems: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    minHeight: 44,
    padding: 12,
  },
  updateIssueText: { flex: 1, gap: 3, minWidth: 0 },
  calendarStrip: { marginHorizontal: -18, paddingHorizontal: 18, marginBottom: 14 },
  calendarCard: { width: 170, minHeight: 112, marginRight: 10, borderTopWidth: 3 },
  uppercase: { textTransform: 'uppercase', letterSpacing: 0.55 },
  calendarTitle: { fontSize: 15, lineHeight: 20, marginTop: 4 },
  sourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
});

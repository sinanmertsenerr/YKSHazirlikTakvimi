import { MaterialIcons } from '@expo/vector-icons';
import { getNetworkStateAsync } from 'expo-network';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Card, Chip, EmptyState, Footnote, Screen } from '@/components/ui';
import { calendarPack, newsPack, useContentRevisionStore } from '@/data/content';
import { refreshNews } from '@/features/news/newsCache';
import { useTheme } from '@/theme/useTheme';
import {
  daysUntil,
  formatDateOnly,
  localizeEmbeddedDateTokens,
  relativeTime,
} from '@/utils/format';
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

export default function NewsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const [network, setNetwork] = useState<{
    isInternetReachable?: boolean;
    isConnected?: boolean;
  }>({});
  useContentRevisionStore((state) => state.revision);
  const [refreshing, setRefreshing] = useState(false);
  const items = newsPack.items;
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const offline = network.isInternetReachable === false || network.isConnected === false;
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

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshNews();
    } catch {
      Alert.alert(t('news.title'), offline ? t('news.offline') : t('common.retry'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen
      refreshControl={
        <RefreshControl
          colors={[colors.brand]}
          onRefresh={() => void onRefresh()}
          refreshing={refreshing}
          tintColor={colors.brand}
        />
      }
    >
      <AppHeader title={t('news.title')} subtitle={t('news.subtitle')} />
      {offline ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.offline, { backgroundColor: colors.warning, borderRadius: 12 }]}
        >
          <MaterialIcons color="#111113" name="cloud-off" size={20} />
          <Text style={[typography.footnote, { color: '#111113', flex: 1, fontWeight: '700' }]}>
            {t('news.offline')}
          </Text>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.calendarStrip}>
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
              <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
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
                  Alert.alert(t('common.externalLink'), t('common.retry')),
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

      {!items.length ? (
        <EmptyState
          action={{ title: t('news.refresh'), onPress: () => void onRefresh() }}
          body={t('news.noNewsBody')}
          icon="newspaper"
          title={t('news.noNews')}
        />
      ) : (
        items.map((item) => (
          <Pressable
            accessibilityHint={t('common.externalLink')}
            accessibilityRole="link"
            key={item.id}
            onPress={() =>
              void openAllowed(item.url).catch(() =>
                Alert.alert(t('common.externalLink'), t('common.retry')),
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
                <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                  {relativeTime(new Date(item.publishedAt).getTime(), language)}
                </Text>
              </View>
              <Text style={[typography.headline, { color: colors.label }]}>
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
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  offline: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  calendarStrip: { marginHorizontal: -18, paddingHorizontal: 18, marginBottom: 14 },
  calendarCard: { width: 170, minHeight: 112, marginRight: 10, borderTopWidth: 3 },
  uppercase: { textTransform: 'uppercase', letterSpacing: 0.55 },
  calendarTitle: { fontSize: 15, lineHeight: 20, marginTop: 4 },
  sourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
});

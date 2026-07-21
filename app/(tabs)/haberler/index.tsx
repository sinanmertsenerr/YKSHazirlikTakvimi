import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getNetworkStateAsync } from 'expo-network';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  type ListRenderItem,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, ScreenView } from '@/components/ui';
import { calendarPack, newsPack, type NewsItem, useContentRevisionStore } from '@/data/content';
import { refreshNews } from '@/features/news/newsCache';
import { useSettingsStore } from '@/stores/settings';
import type { ThemeColors } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  daysUntil,
  formatDateOnly,
  formatInstantDate,
  localizeEmbeddedDateTokens,
  relativeTime,
} from '@/utils/format';
import { getContentUpdateIssue } from '@/utils/contentUpdateError';
import { officialCalendarEventUrl } from '@/utils/officialUrls';

const CURRENT_NEWS_LIMIT = 2;
const ARCHIVE_INITIAL_LIMIT = 5;

type NewsFilter = 'all' | NewsItem['source'];

const allowedHosts = new Set([
  'www.osym.gov.tr',
  'osym.gov.tr',
  'sonuc.osym.gov.tr',
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

function formatMonthLabel(value: string, language: 'tr' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: 'long',
    }).format(new Date(value));
  } catch {
    return value.slice(0, 7);
  }
}

function sourcePalette(source: NewsItem['source'], colors: ThemeColors) {
  return source === 'ÖSYM'
    ? { background: colors.brandSoft, foreground: colors.brand }
    : { background: colors.aytSoft, foreground: colors.aytText };
}

export default function NewsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, dark, radii, typography } = useTheme();
  useContentRevisionStore((state) => state.revision);
  const lastPackFailureTs = useSettingsStore((state) => state.lastPackFailureTs);
  const lastPackError = useSettingsStore((state) => state.lastPackError);
  const [network, setNetwork] = useState<{
    isInternetReachable?: boolean;
    isConnected?: boolean;
  }>({});
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<NewsFilter>('all');
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
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

  const sortedItems = [...newsPack.items].sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  );
  const filteredItems =
    filter === 'all' ? sortedItems : sortedItems.filter((item) => item.source === filter);
  const currentItems = filteredItems.slice(0, CURRENT_NEWS_LIMIT);
  const archivedItems = filteredItems.slice(CURRENT_NEWS_LIMIT);
  const visibleArchivedItems = archiveExpanded
    ? archivedItems
    : archivedItems.slice(0, ARCHIVE_INITIAL_LIMIT);
  const currentDate = new Date(now);
  const upcomingEvent =
    [...calendarPack.events]
      .filter((event) => daysUntil(event.start, currentDate) >= 0)
      .sort((left, right) => left.start.localeCompare(right.start))[0] ?? null;
  const showUpcomingEvent = upcomingEvent !== null && filter !== 'YÖK';
  const upcomingSource = officialCalendarEventUrl(upcomingEvent);
  const upcomingDays = upcomingEvent ? daysUntil(upcomingEvent.start, currentDate) : null;
  const featuredGradient = dark
    ? (['#282548', '#201F31', colors.surface] as const)
    : (['#E9E7FF', '#F8F7FF', colors.surface] as const);
  const filterOptions: { label: string; value: NewsFilter }[] = [
    { label: t('news.allSources'), value: 'all' },
    { label: 'ÖSYM', value: 'ÖSYM' },
    { label: 'YÖK', value: 'YÖK' },
  ];

  useEffect(() => {
    const refreshActiveState = () => {
      setNow(Date.now());
      void getNetworkStateAsync()
        .then(setNetwork)
        .catch(() => setNetwork({}));
    };
    refreshActiveState();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshActiveState();
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

  const onOpenNews = useCallback(
    (item: NewsItem) => {
      void openAllowed(item.url).catch(() =>
        Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
      );
    },
    [t],
  );

  const renderArchiveItem: ListRenderItem<NewsItem> = ({ item, index }) => {
    const previous = visibleArchivedItems[index - 1];
    const next = visibleArchivedItems[index + 1];
    const monthKey = item.publishedAt.slice(0, 7);
    const startsMonth = !previous || previous.publishedAt.slice(0, 7) !== monthKey;
    const endsMonth = !next || next.publishedAt.slice(0, 7) !== monthKey;
    const palette = sourcePalette(item.source, colors);
    const title = localizeEmbeddedDateTokens(item.title[language], language);

    return (
      <View>
        {startsMonth ? (
          <Text style={[typography.caption, styles.monthLabel, { color: colors.tertiaryLabel }]}>
            {formatMonthLabel(item.publishedAt, language)}
          </Text>
        ) : null}
        <Pressable
          accessibilityHint={t('common.externalLink')}
          accessibilityLabel={title}
          accessibilityRole="link"
          android_ripple={{ color: colors.brandSoft }}
          onPress={() => onOpenNews(item)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <View
            style={[
              styles.archiveRow,
              {
                backgroundColor: colors.surface,
                borderColor: colors.separator,
              },
              startsMonth && styles.archiveRowFirst,
              endsMonth && styles.archiveRowLast,
              endsMonth && styles.archiveGroupEnd,
            ]}
          >
            <View style={[styles.archiveSource, { backgroundColor: palette.background }]}>
              <Text style={[styles.archiveSourceText, { color: palette.foreground }]}>
                {item.source}
              </Text>
            </View>
            <View style={styles.archiveCopy}>
              <Text numberOfLines={2} style={[styles.archiveTitle, { color: colors.label }]}>
                {title}
              </Text>
              <Text style={[typography.caption, { color: colors.tertiaryLabel }]}>
                {formatInstantDate(item.publishedAt, language)}
              </Text>
              {item.sample ? (
                <Text style={[typography.caption, { color: colors.warningText }]}>
                  {t('news.sampleData')}
                </Text>
              ) : null}
            </View>
            <MaterialIcons color={colors.tertiaryLabel} name="chevron-right" size={22} />
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <ScreenView>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={visibleArchivedItems}
        initialNumToRender={8}
        keyExtractor={(item) => item.id}
        ListFooterComponent={
          archivedItems.length > ARCHIVE_INITIAL_LIMIT ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setArchiveExpanded((value) => !value)}
              style={({ pressed }) => [
                styles.moreButton,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.separator,
                  borderRadius: radii.button,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[typography.footnote, styles.moreButtonText, { color: colors.brand }]}>
                {archiveExpanded ? t('news.showLess') : t('news.showMore')}
              </Text>
              <MaterialIcons
                color={colors.brand}
                name={archiveExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={20}
              />
            </Pressable>
          ) : null
        }
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text
                  accessibilityRole="header"
                  style={[styles.screenTitle, { color: colors.label }]}
                >
                  {t('news.title')}
                </Text>
                <Text
                  style={[
                    typography.subhead,
                    styles.screenSubtitle,
                    { color: colors.secondaryLabel },
                  ]}
                >
                  {t('news.subtitle')}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={t('common.settings')}
                accessibilityRole="button"
                android_ripple={{ color: colors.brandSoft, borderless: true }}
                hitSlop={6}
                onPress={() => router.push('/ayarlar')}
                style={({ pressed }) => [
                  styles.settingsButton,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.separator,
                    borderRadius: radii.button,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <MaterialIcons color={colors.secondaryLabel} name="settings" size={22} />
              </Pressable>
            </View>

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

            <View accessibilityRole="tablist" style={styles.filters}>
              {filterOptions.map((option) => {
                const selected = option.value === filter;
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    key={option.value}
                    onPress={() => {
                      setFilter(option.value);
                      setArchiveExpanded(false);
                    }}
                    style={({ pressed }) => [
                      styles.filter,
                      {
                        backgroundColor: selected ? colors.brand : colors.surface,
                        borderColor: selected ? colors.brand : colors.separator,
                        borderRadius: radii.pill,
                      },
                      selected && styles.selectedFilter,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        { color: selected ? colors.onBrand : colors.secondaryLabel },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {showUpcomingEvent || currentItems.length > 0 ? (
              <View>
                <View style={styles.sectionHeading}>
                  <Text style={[styles.sectionTitle, { color: colors.label }]}>
                    {t('news.current')}
                  </Text>
                  <View style={styles.currentDate}>
                    <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
                    <Text style={[typography.caption, { color: colors.tertiaryLabel }]}>
                      {formatInstantDate(now, language)}
                    </Text>
                  </View>
                </View>

                {showUpcomingEvent && upcomingEvent ? (
                  <Pressable
                    accessibilityHint={upcomingSource ? t('common.officialSource') : undefined}
                    accessibilityLabel={upcomingEvent.title[language]}
                    accessibilityRole={upcomingSource ? 'link' : undefined}
                    disabled={!upcomingSource}
                    onPress={() => {
                      if (!upcomingSource) return;
                      void openAllowed(upcomingSource).catch(() =>
                        Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
                      );
                    }}
                    style={({ pressed }) => [styles.featuredPressable, pressed && styles.pressed]}
                  >
                    <LinearGradient
                      colors={featuredGradient}
                      end={{ x: 1, y: 1 }}
                      start={{ x: 0, y: 0 }}
                      style={[
                        styles.featured,
                        { borderColor: colors.separator, borderRadius: radii.sheet },
                      ]}
                    >
                      <View
                        pointerEvents="none"
                        style={[styles.featuredHaloLarge, { borderColor: colors.brand }]}
                      />
                      <View
                        pointerEvents="none"
                        style={[styles.featuredHaloSmall, { borderColor: colors.brand }]}
                      />
                      <MaterialIcons
                        color={colors.brand}
                        name="calendar-month"
                        size={58}
                        style={styles.featuredCalendarIcon}
                      />

                      <View style={styles.featuredTopRow}>
                        <View style={[styles.featuredBadge, { backgroundColor: colors.brandSoft }]}>
                          <Text style={[styles.featuredBadgeText, { color: colors.brand }]}>
                            {t('news.calendar')}
                            {upcomingEvent.approximate ? ` · ${t('news.expected')}` : ''}
                          </Text>
                        </View>
                        {upcomingDays !== null ? (
                          <View
                            style={[
                              styles.countdownBadge,
                              { backgroundColor: dark ? colors.surfaceSecondary : colors.surface },
                            ]}
                          >
                            <Text style={[styles.countdownText, { color: colors.danger }]}>
                              {upcomingDays === 0
                                ? t('news.today')
                                : upcomingDays === 1
                                  ? t('news.tomorrow')
                                  : t('news.daysLeft', { count: upcomingDays })}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <Text
                        numberOfLines={2}
                        style={[styles.featuredTitle, { color: colors.label }]}
                      >
                        {upcomingEvent.title[language]}
                      </Text>
                      <Text style={[styles.featuredDate, { color: colors.brand }]}>
                        {formatDateOnly(upcomingEvent.start, language)}
                        {upcomingEvent.end
                          ? ` – ${formatDateOnly(upcomingEvent.end, language)}`
                          : ''}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={[
                          typography.footnote,
                          styles.featuredBody,
                          { color: colors.secondaryLabel },
                        ]}
                      >
                        {t('news.featuredBody')}
                      </Text>

                      {upcomingSource ? (
                        <View
                          style={[
                            styles.featuredAction,
                            { backgroundColor: colors.brand, borderRadius: radii.button },
                          ]}
                        >
                          <Text style={[typography.caption, { color: colors.onBrand }]}>
                            {t('news.viewDetails')}
                          </Text>
                          <MaterialIcons color={colors.onBrand} name="arrow-forward" size={15} />
                        </View>
                      ) : null}
                    </LinearGradient>
                  </Pressable>
                ) : null}

                <View style={styles.currentList}>
                  {currentItems.map((item) => {
                    const palette = sourcePalette(item.source, colors);
                    const title = localizeEmbeddedDateTokens(item.title[language], language);
                    return (
                      <Pressable
                        accessibilityHint={t('common.externalLink')}
                        accessibilityLabel={title}
                        accessibilityRole="link"
                        android_ripple={{ color: colors.brandSoft }}
                        key={item.id}
                        onPress={() => onOpenNews(item)}
                        style={({ pressed }) => [pressed && styles.pressed]}
                      >
                        <View
                          style={[
                            styles.currentCard,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.separator,
                              borderRadius: radii.hero,
                            },
                          ]}
                        >
                          <View
                            style={[styles.currentSource, { backgroundColor: palette.background }]}
                          >
                            <Text style={[styles.currentSourceText, { color: palette.foreground }]}>
                              {item.source}
                            </Text>
                          </View>
                          <View style={styles.currentCopy}>
                            <View style={styles.currentMeta}>
                              <Text
                                style={[styles.currentMetaSource, { color: palette.foreground }]}
                              >
                                {item.source}
                              </Text>
                              <Text style={[typography.caption, { color: colors.tertiaryLabel }]}>
                                · {relativeTime(new Date(item.publishedAt).getTime(), language)}
                              </Text>
                            </View>
                            <Text
                              numberOfLines={2}
                              style={[styles.currentTitle, { color: colors.label }]}
                            >
                              {title}
                            </Text>
                            {item.sample ? (
                              <Text style={[typography.caption, { color: colors.warningText }]}>
                                {t('news.sampleData')}
                              </Text>
                            ) : null}
                          </View>
                          <MaterialIcons
                            color={colors.tertiaryLabel}
                            name="chevron-right"
                            size={22}
                          />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {filteredItems.length === 0 ? (
              <EmptyState
                action={{ title: t('news.refresh'), onPress: () => void onRefresh() }}
                body={filter === 'all' ? t('news.noNewsBody') : t('news.noSourceNewsBody')}
                icon="newspaper"
                title={filter === 'all' ? t('news.noNews') : t('news.noSourceNews')}
              />
            ) : null}

            {archivedItems.length > 0 ? (
              <View style={[styles.sectionHeading, styles.archiveHeading]}>
                <Text style={[styles.sectionTitle, { color: colors.label }]}>{t('news.past')}</Text>
                <Text style={[typography.caption, { color: colors.tertiaryLabel }]}>
                  {t('news.newestFirst')}
                </Text>
              </View>
            ) : null}
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
        renderItem={renderArchiveItem}
        showsVerticalScrollIndicator={false}
        windowSize={7}
      />
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 132 },
  headerRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 20,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  screenTitle: { fontSize: 34, lineHeight: 39, fontWeight: '800', letterSpacing: -1.1 },
  screenSubtitle: { marginTop: 4 },
  settingsButton: {
    width: 44,
    height: 44,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  offline: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  updateIssue: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  updateIssueText: { flex: 1, gap: 3, minWidth: 0 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  filter: {
    minHeight: 38,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  selectedFilter: {
    shadowColor: '#4F46E5',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  filterText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  sectionHeading: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginHorizontal: 2,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.35 },
  currentDate: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  featuredPressable: { marginBottom: 10 },
  featured: {
    minHeight: 238,
    overflow: 'hidden',
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#3E35A0',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 4,
  },
  featuredHaloLarge: {
    position: 'absolute',
    right: -58,
    bottom: -72,
    width: 196,
    height: 196,
    borderRadius: 98,
    borderWidth: 1,
    opacity: 0.12,
  },
  featuredHaloSmall: {
    position: 'absolute',
    right: -30,
    bottom: -44,
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
    opacity: 0.14,
  },
  featuredCalendarIcon: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    opacity: 0.13,
  },
  featuredTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  featuredBadge: {
    minHeight: 27,
    maxWidth: '58%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  featuredBadgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  },
  countdownBadge: {
    minHeight: 27,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  countdownText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },
  featuredTitle: {
    maxWidth: '78%',
    marginTop: 24,
    fontSize: 27,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.85,
  },
  featuredDate: { marginTop: 7, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  featuredBody: { maxWidth: '78%', marginTop: 8 },
  featuredAction: {
    minHeight: 38,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    marginTop: 16,
  },
  currentList: { gap: 9 },
  currentCard: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  currentSource: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  currentSourceText: { fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: -0.2 },
  currentCopy: { flex: 1, minWidth: 0, gap: 3 },
  currentMeta: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  currentMetaSource: { fontSize: 10, lineHeight: 14, fontWeight: '800' },
  currentTitle: { fontSize: 14, lineHeight: 18, fontWeight: '700', letterSpacing: -0.15 },
  archiveHeading: { marginTop: 30, marginBottom: 8 },
  monthLabel: { marginTop: 8, marginBottom: 7, marginLeft: 2, textTransform: 'uppercase' },
  archiveRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  archiveRowFirst: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  archiveRowLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  archiveGroupEnd: {
    marginBottom: 5,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  archiveSource: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  archiveSourceText: { fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: -0.2 },
  archiveCopy: { flex: 1, minWidth: 0, gap: 4 },
  archiveTitle: { fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: -0.12 },
  moreButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  moreButtonText: { fontWeight: '700' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
});

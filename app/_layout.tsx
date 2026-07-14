import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import i18n, { resolveLanguage } from '@/i18n';
import {
  calendarPack,
  initializeActiveContent,
  reloadActiveContent,
  useContentRevisionStore,
} from '@/data/content';
import { checkForPackUpdate } from '@/data/packUpdater';
import { resolveExamYear } from '@/features/calendar/examYear';
import { AppDataProvider } from '@/providers/AppDataProvider';
import {
  installLocalNotificationHandler,
  rescheduleLocalNotificationsIfAuthorized,
} from '@/services/notifications';
import { useSettingsStore } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';

void SplashScreen.preventAutoHideAsync();

function reconcileAutomaticExamYear(): number {
  const settings = useSettingsStore.getState();
  const resolved = resolveExamYear(settings.examYear, settings.examYearMode, calendarPack.events);
  if (settings.examYearMode === 'automatic' && resolved !== settings.examYear) {
    settings.setAutomaticExamYear(resolved);
  }
  return resolved;
}

async function syncNotificationsForActiveContent() {
  if (Platform.OS === 'web') return;
  const settings = useSettingsStore.getState();
  const examYear = reconcileAutomaticExamYear();
  const notificationLanguage = resolveLanguage(settings.language) === 'en' ? 'en' : 'tr';
  const events = calendarPack.events.filter(
    (event) => Number(event.start.slice(0, 4)) === examYear,
  );
  const result = await rescheduleLocalNotificationsIfAuthorized(
    settings.notificationPrefs,
    events,
    notificationLanguage,
  );
  if (
    result.permission === 'denied' &&
    (settings.notificationPrefs.dailyEnabled || settings.notificationPrefs.dateAlertsEnabled)
  ) {
    settings.setNotificationPrefs({ dailyEnabled: false, dateAlertsEnabled: false });
  }
}

export default function RootLayout() {
  const { colors, dark } = useTheme();
  const language = useSettingsStore((state) => state.language);
  const contentRevision = useContentRevisionStore((state) => state.revision);
  const [contentReady, setContentReady] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    void i18n.changeLanguage(resolveLanguage(language));
  }, [language]);

  useEffect(() => {
    if (Platform.OS !== 'web') void installLocalNotificationHandler();
  }, []);

  useEffect(() => {
    let active = true;
    const refreshContent = async () => {
      const result = await checkForPackUpdate();
      if (result.status === 'updated') {
        await reloadActiveContent();
        return;
      }
      await syncNotificationsForActiveContent();
    };
    void initializeActiveContent()
      .catch(() => false)
      .finally(() => {
        if (!active) return;
        reconcileAutomaticExamYear();
        setContentReady(true);
        void SplashScreen.hideAsync();
        void refreshContent().catch(() => undefined);
      });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshContent().catch(() => undefined);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!contentReady || contentRevision === 0) return;
    void syncNotificationsForActiveContent().catch(() => undefined);
  }, [contentReady, contentRevision]);

  if (!contentReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <AppDataProvider>
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.background },
            headerShown: false,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="ayarlar"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: t('settings.title'),
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.label,
              headerShadowVisible: false,
            }}
          />
        </Stack>
      </AppDataProvider>
    </View>
  );
}

import type { NotificationPermissionsStatus, NotificationRequest } from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotificationPreferences } from '@/stores/settings';

export const LOCAL_NOTIFICATION_CHANNEL_ID = 'yks-reminders';
const OWNER = 'yks-hazirlik-local';
const IDENTIFIER_PREFIX = 'yks-local:';
const DAILY_IDENTIFIER = `${IDENTIFIER_PREFIX}daily`;
let scheduleQueue: Promise<unknown> = Promise.resolve();
let notificationsModule: typeof import('expo-notifications') | null = null;

function getNotifications() {
  // Inline require keeps the native module out of Expo Router's web/static render path while
  // preserving Metro's normal native-module resolution on iOS and Android.
  notificationsModule ??= require('expo-notifications') as typeof import('expo-notifications');
  return notificationsModule;
}

export type NotificationLanguage = 'tr' | 'en';

export type NotificationCalendarEvent = {
  id: string;
  start: string;
  title: { tr: string; en: string };
  verified: boolean;
  approximate?: boolean;
  sample?: boolean;
};

export type NotificationSyncResult = {
  permission: 'not-requested' | 'granted' | 'denied';
  scheduled: number;
};

/** SDK 57 uses banner/list presentation flags instead of the deprecated alert flag. */
export function installLocalNotificationHandler(): void {
  const Notifications = getNotifications();
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = getNotifications();
  await Notifications.setNotificationChannelAsync(LOCAL_NOTIFICATION_CHANNEL_ID, {
    name: 'YKS Hatırlatmaları',
    description: 'Günlük çalışma ve resmi YKS tarihi hatırlatmaları',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 180, 120, 180],
    enableVibrate: true,
    showBadge: false,
  });
}

function permissionGranted(status: NotificationPermissionsStatus): boolean {
  if (status.granted || status.status === 'granted') return true;
  const iosStatus = status.ios?.status;
  const Notifications = getNotifications();
  return (
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

export async function requestLocalNotificationPermission(): Promise<boolean> {
  // Android 13+ will not show a useful permission prompt until a channel exists.
  await ensureAndroidNotificationChannel();
  const Notifications = getNotifications();
  const current = await Notifications.getPermissionsAsync();
  if (permissionGranted(current)) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return permissionGranted(requested);
}

function belongsToThisService(request: NotificationRequest): boolean {
  return request.identifier.startsWith(IDENTIFIER_PREFIX) || request.content.data?.owner === OWNER;
}

/** Cancels only schedules owned by this service, leaving unrelated app notifications intact. */
export async function cancelManagedLocalNotifications(): Promise<void> {
  const Notifications = getNotifications();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(belongsToThisService)
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

function isoDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Returns 09:00 Europe/Istanbul one day before, or event morning for a late opt-in. */
export function calendarAlertTimestamp(start: string, now = Date.now()): number | null {
  const parts = isoDateParts(start);
  if (!parts) return null;
  const eventMorning = Date.parse(
    `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(
      parts.day,
    ).padStart(2, '0')}T09:00:00+03:00`,
  );
  if (!Number.isFinite(eventMorning) || eventMorning <= now) return null;
  const dayBefore = eventMorning - 24 * 60 * 60 * 1000;
  return dayBefore > now ? dayBefore : eventMorning;
}

function localizedCopy(language: NotificationLanguage) {
  return language === 'en'
    ? {
        dailyTitle: 'A small step for YKS',
        dailyBody: 'Review today’s plan and keep your progress moving.',
        calendarTitle: 'YKS calendar reminder',
        calendarBody: (title: string) => `${title} is approaching.`,
      }
    : {
        dailyTitle: 'YKS için küçük bir adım',
        dailyBody: 'Bugünkü planına göz at ve ilerlemeni sürdür.',
        calendarTitle: 'YKS takvim hatırlatması',
        calendarBody: (title: string) => `${title} yaklaşıyor.`,
      };
}

function eventIdentifier(event: NotificationCalendarEvent): string {
  const safeId = event.id.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64);
  let hash = 2166136261;
  for (const character of `${event.id}:${event.start}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${IDENTIFIER_PREFIX}calendar:${safeId}:${(hash >>> 0).toString(16)}`;
}

/**
 * Replaces the complete managed schedule. Stable identifiers and serialized calls make repeated
 * requests duplicate-free; stale entries are removed only after new schedules succeed.
 */
async function performNotificationReschedule(
  preferences: NotificationPreferences,
  events: readonly NotificationCalendarEvent[],
  language: NotificationLanguage,
  now = Date.now(),
): Promise<NotificationSyncResult> {
  await ensureAndroidNotificationChannel();
  const Notifications = getNotifications();

  if (!preferences.dailyEnabled && !preferences.dateAlertsEnabled) {
    await cancelManagedLocalNotifications();
    return { permission: 'not-requested', scheduled: 0 };
  }
  if (!(await requestLocalNotificationPermission())) {
    await cancelManagedLocalNotifications();
    return { permission: 'denied', scheduled: 0 };
  }

  const copy = localizedCopy(language);
  const existing = (await Notifications.getAllScheduledNotificationsAsync()).filter(
    belongsToThisService,
  );
  const desiredIdentifiers = new Set<string>();
  let scheduled = 0;
  if (preferences.dailyEnabled) {
    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_IDENTIFIER,
      content: {
        title: copy.dailyTitle,
        body: copy.dailyBody,
        sound: 'default',
        data: { owner: OWNER, kind: 'daily' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Math.max(0, Math.min(23, Math.trunc(preferences.hour))),
        minute: Math.max(0, Math.min(59, Math.trunc(preferences.minute))),
        channelId: LOCAL_NOTIFICATION_CHANNEL_ID,
      },
    });
    desiredIdentifiers.add(DAILY_IDENTIFIER);
    scheduled += 1;
  }

  if (preferences.dateAlertsEnabled) {
    const uniqueEvents = new Map(events.map((event) => [event.id, event]));
    for (const event of uniqueEvents.values()) {
      // The setting promises official date alerts, so fixtures and unverified dates stay silent.
      if (!event.verified || event.approximate || event.sample) continue;
      const timestamp = calendarAlertTimestamp(event.start, now);
      if (timestamp === null) continue;
      const identifier = eventIdentifier(event);
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: copy.calendarTitle,
          body: copy.calendarBody(language === 'en' ? event.title.en : event.title.tr),
          sound: 'default',
          data: { owner: OWNER, kind: 'calendar', eventId: event.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: timestamp,
          channelId: LOCAL_NOTIFICATION_CHANNEL_ID,
        },
      });
      desiredIdentifiers.add(identifier);
      scheduled += 1;
    }
  }

  await Promise.all(
    existing
      .filter((request) => !desiredIdentifiers.has(request.identifier))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );

  return { permission: 'granted', scheduled };
}

export function rescheduleLocalNotifications(
  preferences: NotificationPreferences,
  events: readonly NotificationCalendarEvent[],
  language: NotificationLanguage,
  now = Date.now(),
): Promise<NotificationSyncResult> {
  const operation = scheduleQueue
    .catch(() => undefined)
    .then(() => performNotificationReschedule(preferences, events, language, now));
  scheduleQueue = operation;
  return operation;
}

/**
 * Background/app-start synchronization must never surprise the user with a permission prompt.
 * Explicit settings actions use `rescheduleLocalNotifications`; lifecycle refreshes use this
 * passive variant and only rebuild schedules when permission already exists.
 */
export async function rescheduleLocalNotificationsIfAuthorized(
  preferences: NotificationPreferences,
  events: readonly NotificationCalendarEvent[],
  language: NotificationLanguage,
  now = Date.now(),
): Promise<NotificationSyncResult> {
  if (!preferences.dailyEnabled && !preferences.dateAlertsEnabled) {
    return rescheduleLocalNotifications(preferences, events, language, now);
  }

  const current = await getNotifications().getPermissionsAsync();
  if (!permissionGranted(current)) {
    await cancelManagedLocalNotifications();
    return {
      permission: current.canAskAgain ? 'not-requested' : 'denied',
      scheduled: 0,
    };
  }
  return rescheduleLocalNotifications(preferences, events, language, now);
}

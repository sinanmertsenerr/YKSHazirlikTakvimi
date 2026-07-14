/* eslint-disable import/first */

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 5 },
  IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
}));

import * as Notifications from 'expo-notifications';

import {
  calendarAlertTimestamp,
  installLocalNotificationHandler,
  rescheduleLocalNotifications,
  rescheduleLocalNotificationsIfAuthorized,
} from './notifications';

const mockNotifications = {
  setNotificationHandler: Notifications.setNotificationHandler as jest.Mock,
  setNotificationChannelAsync: Notifications.setNotificationChannelAsync as jest.Mock,
  getPermissionsAsync: Notifications.getPermissionsAsync as jest.Mock,
  requestPermissionsAsync: Notifications.requestPermissionsAsync as jest.Mock,
  getAllScheduledNotificationsAsync: Notifications.getAllScheduledNotificationsAsync as jest.Mock,
  cancelScheduledNotificationAsync: Notifications.cancelScheduledNotificationAsync as jest.Mock,
  scheduleNotificationAsync: Notifications.scheduleNotificationAsync as jest.Mock,
};

describe('local notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotifications.setNotificationChannelAsync.mockResolvedValue(null);
    mockNotifications.getPermissionsAsync.mockResolvedValue({
      granted: true,
      status: 'granted',
      canAskAgain: true,
    });
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    mockNotifications.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
    mockNotifications.scheduleNotificationAsync.mockResolvedValue('scheduled');
  });

  it('uses the SDK 57 banner and list handler fields', async () => {
    await installLocalNotificationHandler();
    const handler = mockNotifications.setNotificationHandler.mock.calls[0]?.[0] as {
      handleNotification: () => Promise<Record<string, boolean>>;
    };
    await expect(handler.handleNotification()).resolves.toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
    });
  });

  it('computes a Turkey-time alert and falls forward for a late opt-in', () => {
    const dayBefore = Date.parse('2027-06-18T09:00:00+03:00');
    expect(calendarAlertTimestamp('2027-06-19', dayBefore - 1)).toBe(dayBefore);
    expect(calendarAlertTimestamp('2027-06-19', dayBefore + 1)).toBe(
      Date.parse('2027-06-19T09:00:00+03:00'),
    );
    expect(calendarAlertTimestamp('invalid', 0)).toBeNull();
    expect(calendarAlertTimestamp('2027-02-31', 0)).toBeNull();
  });

  it('cancels only managed schedules and creates one schedule per logical reminder', async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      {
        identifier: 'yks-local:calendar:stale',
        content: { data: { owner: 'yks-hazirlik-local' } },
        trigger: {},
      },
      { identifier: 'someone-else', content: { data: {} }, trigger: {} },
    ]);
    const event = {
      id: 'yks-2027',
      start: '2027-06-19',
      title: { tr: 'YKS', en: 'YKS' },
      verified: true,
      sample: false,
    };

    const result = await rescheduleLocalNotifications(
      { dailyEnabled: true, dateAlertsEnabled: true, hour: 19, minute: 15 },
      [event, event, { ...event, id: 'fixture', verified: false }],
      'tr',
      Date.parse('2027-01-01T00:00:00+03:00'),
    );

    expect(result).toEqual({ permission: 'granted', scheduled: 2 });
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'yks-local:calendar:stale',
    );
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('does not prompt or schedule during background sync without prior permission', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'undetermined',
      canAskAgain: true,
    });

    await expect(
      rescheduleLocalNotificationsIfAuthorized(
        { dailyEnabled: false, dateAlertsEnabled: true, hour: 19, minute: 0 },
        [],
        'tr',
      ),
    ).resolves.toEqual({ permission: 'not-requested', scheduled: 0 });
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('rebuilds enabled schedules during background sync when permission already exists', async () => {
    await expect(
      rescheduleLocalNotificationsIfAuthorized(
        { dailyEnabled: true, dateAlertsEnabled: false, hour: 19, minute: 0 },
        [],
        'en',
      ),
    ).resolves.toEqual({ permission: 'granted', scheduled: 1 });
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});

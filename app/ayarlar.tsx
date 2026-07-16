import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, SegmentedControl } from '@/components/ui';
import { calendarPack, calendarPackSchema, reloadActiveContent } from '@/data/content';
import { checkForPackUpdate, getActivePackFile } from '@/data/packUpdater';
import { currentIstanbulYear, resolveExamYear } from '@/features/calendar/examYear';
import { useAppData } from '@/providers/AppDataProvider';
import { exportUserBackup, pickAndValidateBackup, type BackupSnapshot } from '@/services/backup';
import { rescheduleLocalNotifications } from '@/services/notifications';
import {
  getSettingsSnapshot,
  type LanguagePreference,
  type NotificationPreferences,
  type ScoreType,
  type ThemePreference,
  useSettingsStore,
} from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';
import { getContentUpdateIssue } from '@/utils/contentUpdateError';

type LocalLanguage = 'tr' | 'en';

function formatPackCheckTime(value: number, language: LocalLanguage): string {
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

async function calendarEventsForNotifications(examYear: number) {
  let events = calendarPack.events;
  try {
    const downloadedCalendar = await getActivePackFile('calendar');
    if (downloadedCalendar) {
      const parsed = calendarPackSchema.safeParse(
        JSON.parse(await downloadedCalendar.text()) as unknown,
      );
      if (parsed.success) events = parsed.data.events;
    }
  } catch {
    // A missing/corrupt downloaded file never prevents the bundled calendar fallback.
  }
  return events.filter((event) => Number(event.start.slice(0, 4)) === examYear);
}

function SectionLabel({ children }: { children: string }) {
  const { colors, typography } = useTheme();
  return (
    <Text style={[typography.caption, styles.sectionLabel, { color: colors.secondaryLabel }]}>
      {children}
    </Text>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  const { colors, radii } = useTheme();
  return (
    <View
      style={[
        styles.group,
        {
          backgroundColor: colors.surface,
          borderColor: colors.separator,
          borderRadius: radii.card,
        },
      ]}
    >
      {children}
    </View>
  );
}

function SettingRow({
  icon,
  label,
  detail,
  right,
  onPress,
  last = false,
  disabled = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  detail?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  disabled?: boolean;
}) {
  const { colors, typography } = useTheme();
  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: colors.brandSoft }]}>
        <MaterialIcons color={colors.brand} name={icon} size={20} />
      </View>
      <View style={styles.rowText}>
        <Text style={[typography.body, { color: colors.label }]}>{label}</Text>
        {detail ? (
          <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>{detail}</Text>
        ) : null}
      </View>
      {right}
      {onPress ? (
        <MaterialIcons color={colors.secondaryLabel} name="chevron-right" size={24} />
      ) : null}
    </>
  );
  const rowStyle = [
    styles.row,
    !last && { borderBottomColor: colors.separator, borderBottomWidth: StyleSheet.hairlineWidth },
    disabled && styles.disabled,
  ];
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onCommit: (value: number) => void;
}) {
  const { colors, radii, typography } = useTheme();
  const [text, setText] = useState(String(value));

  const commit = () => {
    const parsed = Number(text.replace(',', '.'));
    const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
    const rounded = Math.round(next * 10) / 10;
    setText(String(rounded));
    onCommit(rounded);
  };

  return (
    <View style={styles.numberField}>
      <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>{label}</Text>
      <View style={styles.numberInputRow}>
        <TextInput
          accessibilityLabel={label}
          inputMode="decimal"
          maxLength={5}
          onBlur={commit}
          onChangeText={setText}
          onSubmitEditing={commit}
          returnKeyType="done"
          selectTextOnFocus
          style={[
            typography.body,
            styles.numberInput,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.separator,
              borderRadius: radii.button,
              color: colors.label,
            },
          ]}
          value={text}
        />
        <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>{suffix}</Text>
      </View>
    </View>
  );
}

function TimeControl({
  preferences,
  disabled,
  onChange,
  language,
}: {
  preferences: NotificationPreferences;
  disabled: boolean;
  onChange: (next: NotificationPreferences) => void;
  language: LocalLanguage;
}) {
  const { colors, radii, typography } = useTheme();
  const time = `${String(preferences.hour).padStart(2, '0')}:${String(preferences.minute).padStart(2, '0')}`;
  const shift = (delta: number) => {
    const current = preferences.hour * 60 + preferences.minute;
    const total = (current + delta + 24 * 60) % (24 * 60);
    onChange({ ...preferences, hour: Math.floor(total / 60), minute: total % 60 });
  };
  return (
    <View style={styles.timeWrap}>
      <Pressable
        accessibilityLabel={language === 'en' ? '15 minutes earlier' : '15 dakika daha erken'}
        accessibilityRole="button"
        disabled={disabled}
        hitSlop={4}
        onPress={() => shift(-15)}
        style={({ pressed }) => [
          styles.timeButton,
          { backgroundColor: colors.surfaceSecondary, borderRadius: radii.button },
          pressed && styles.pressed,
        ]}
      >
        <MaterialIcons color={colors.brand} name="remove" size={20} />
      </Pressable>
      <Text
        accessibilityLabel={time}
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[typography.headline, { color: colors.label }]}
      >
        {time}
      </Text>
      <Pressable
        accessibilityLabel={language === 'en' ? '15 minutes later' : '15 dakika daha geç'}
        accessibilityRole="button"
        disabled={disabled}
        hitSlop={4}
        onPress={() => shift(15)}
        style={({ pressed }) => [
          styles.timeButton,
          { backgroundColor: colors.surfaceSecondary, borderRadius: radii.button },
          pressed && styles.pressed,
        ]}
      >
        <MaterialIcons color={colors.brand} name="add" size={20} />
      </Pressable>
    </View>
  );
}

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const language: LocalLanguage = i18n.resolvedLanguage === 'en' ? 'en' : 'tr';
  const local = useCallback((tr: string, en: string) => (language === 'en' ? en : tr), [language]);

  const languagePreference = useSettingsStore((state) => state.language);
  const themePreference = useSettingsStore((state) => state.theme);
  const examYear = useSettingsStore((state) => state.examYear);
  const examYearMode = useSettingsStore((state) => state.examYearMode);
  const targetScoreType = useSettingsStore((state) => state.targetScoreType);
  const targetNet = useSettingsStore((state) => state.targetNet);
  const diplomaNote = useSettingsStore((state) => state.diplomaNote);
  const notificationPrefs = useSettingsStore((state) => state.notificationPrefs);
  const activePackVersion = useSettingsStore((state) => state.activePackVersion);
  const lastPackSuccessTs = useSettingsStore((state) => state.lastPackSuccessTs);
  const lastPackFailureTs = useSettingsStore((state) => state.lastPackFailureTs);
  const lastPackError = useSettingsStore((state) => state.lastPackError);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const setExamYear = useSettingsStore((state) => state.setExamYear);
  const setAutomaticExamYear = useSettingsStore((state) => state.setAutomaticExamYear);
  const setTargetScoreType = useSettingsStore((state) => state.setTargetScoreType);
  const setTargetNet = useSettingsStore((state) => state.setTargetNet);
  const setDiplomaNote = useSettingsStore((state) => state.setDiplomaNote);
  const setNotificationPrefs = useSettingsStore((state) => state.setNotificationPrefs);
  const replaceSettings = useSettingsStore((state) => state.replaceSettings);

  const { progress, exams, favorites, activities, ready, restoreSnapshot } = useAppData();
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const packStatusDetail = useMemo(() => {
    const details = [`${t('settings.packVersion')}: ${activePackVersion}`];
    details.push(
      lastPackSuccessTs === null
        ? local('Son başarılı kontrol: henüz yok', 'Last successful check: not yet')
        : `${local('Son başarılı kontrol', 'Last successful check')}: ${formatPackCheckTime(
            lastPackSuccessTs,
            language,
          )}`,
    );
    if (lastPackError && lastPackFailureTs !== null) {
      const issue = getContentUpdateIssue(lastPackError);
      details.push(
        `${local('Son güncelleme kontrolü', 'Latest update check')} (${formatPackCheckTime(
          lastPackFailureTs,
          language,
        )}): ${t(issue.titleKey)}`,
      );
      details.push(t(issue.messageKey));
    }
    return details.join('\n');
  }, [activePackVersion, language, lastPackError, lastPackFailureTs, lastPackSuccessTs, local, t]);

  const yearOptions = useMemo(() => {
    const current = currentIstanbulYear();
    return [
      { label: t('settings.automatic'), value: 'automatic' },
      ...Array.from(new Set([current, current + 1, current + 2, examYear]))
        .sort((left, right) => left - right)
        .map((year) => ({ label: String(year), value: String(year) })),
    ];
  }, [examYear, t]);

  const showError = (error: unknown) => {
    Alert.alert(
      local('İşlem tamamlanamadı', 'Could not complete the action'),
      error instanceof Error ? error.message : String(error),
    );
  };

  const syncNotifications = async (
    next: NotificationPreferences,
    nextLanguage = language,
    nextExamYear = examYear,
  ) => {
    const previous = useSettingsStore.getState().notificationPrefs;
    setNotificationPrefs(next);
    setNotificationBusy(true);
    try {
      const events = await calendarEventsForNotifications(nextExamYear);
      const result = await rescheduleLocalNotifications(next, events, nextLanguage);
      if (result.permission === 'denied') {
        setNotificationPrefs({ dailyEnabled: false, dateAlertsEnabled: false });
        Alert.alert(t('settings.notifications'), t('settings.permissionDenied'));
      }
    } catch (error) {
      setNotificationPrefs(previous);
      try {
        const previousEvents = await calendarEventsForNotifications(examYear);
        await rescheduleLocalNotifications(previous, previousEvents, language);
      } catch {
        // The preference rollback is still authoritative; scheduling can be retried later.
      }
      showError(error);
    } finally {
      setNotificationBusy(false);
    }
  };

  const exportBackup = async () => {
    setBackupBusy(true);
    try {
      await exportUserBackup({ progress, exams, favorites, activities });
      Alert.alert(t('settings.backup'), t('settings.exportDone'));
    } catch (error) {
      showError(error);
    } finally {
      setBackupBusy(false);
    }
  };

  const applyRestore = async (backup: BackupSnapshot) => {
    setRestoreBusy(true);
    try {
      const previousUserData = { progress, exams, favorites, activities };
      const previousSettings = getSettingsSnapshot();
      let userDataApplied = false;
      try {
        // The provider applies all SQLite rows inside its repository transaction.
        await restoreSnapshot(backup.userData);
        userDataApplied = true;
        // Pack files are device-local and are not part of a user backup.
        replaceSettings({
          ...backup.settings,
          examYearMode: 'manual',
          activePackVersion: previousSettings.activePackVersion,
          lastPackCheckTs: previousSettings.lastPackCheckTs,
          lastPackSuccessTs: previousSettings.lastPackSuccessTs,
          lastPackFailureTs: previousSettings.lastPackFailureTs,
          lastPackError: previousSettings.lastPackError,
        });
      } catch (mutationError) {
        if (userDataApplied) {
          try {
            await restoreSnapshot(previousUserData);
            replaceSettings(previousSettings);
          } catch (rollbackError) {
            throw new Error(
              `${mutationError instanceof Error ? mutationError.message : String(mutationError)} ` +
                `${local('Geri alma da başarısız oldu:', 'Rollback also failed:')} ${
                  rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
                }`,
            );
          }
        }
        throw mutationError;
      }
      const restoredLanguage: LocalLanguage =
        backup.settings.language === 'en'
          ? 'en'
          : backup.settings.language === 'tr'
            ? 'tr'
            : language;
      let notificationPermissionDenied = false;
      let notificationError: unknown;
      try {
        const events = await calendarEventsForNotifications(backup.settings.examYear);
        const notificationResult = await rescheduleLocalNotifications(
          backup.settings.notificationPrefs,
          events,
          restoredLanguage,
        );
        notificationPermissionDenied = notificationResult.permission === 'denied';
      } catch (error) {
        notificationError = error;
      }
      Alert.alert(t('settings.restore'), t('settings.restoreDone'));
      if (notificationPermissionDenied) {
        Alert.alert(t('settings.notifications'), t('settings.permissionDenied'));
      } else if (notificationError) {
        Alert.alert(
          t('settings.notifications'),
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
        );
      }
    } catch (error) {
      showError(error);
    } finally {
      setRestoreBusy(false);
    }
  };

  const chooseBackup = async () => {
    setRestoreBusy(true);
    try {
      const backup = await pickAndValidateBackup();
      if (!backup) return;
      Alert.alert(t('settings.restore'), t('settings.restoreConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.restore'),
          style: 'destructive',
          onPress: () => void applyRestore(backup),
        },
      ]);
    } catch (error) {
      showError(error);
    } finally {
      setRestoreBusy(false);
    }
  };

  const updatePack = async () => {
    setPackBusy(true);
    try {
      const result = await checkForPackUpdate({ force: true });
      if (result.status === 'failed') throw result.error;
      if (result.status === 'incompatible') {
        Alert.alert(
          t('settings.updateNow'),
          local(
            `Bu paket uygulamanın en az ${result.manifest.minAppVersion} sürümünü gerektiriyor.`,
            `This pack requires app version ${result.manifest.minAppVersion} or newer.`,
          ),
        );
        return;
      }
      if (result.status === 'updated') await reloadActiveContent();
      const nextExamYear = resolveExamYear(examYear, examYearMode, calendarPack.events);
      if (examYearMode === 'automatic' && nextExamYear !== examYear) {
        setAutomaticExamYear(nextExamYear);
      }
      try {
        const events = await calendarEventsForNotifications(nextExamYear);
        await rescheduleLocalNotifications(notificationPrefs, events, language);
      } catch {
        // Content activation succeeded; notification permission/scheduling can be retried separately.
      }
      Alert.alert(
        t('settings.updateNow'),
        result.status === 'updated'
          ? local(
              `İçerik ${result.active.version} sürümüne güncellendi.`,
              `Content was updated to ${result.active.version}.`,
            )
          : t('settings.updateDone'),
      );
    } catch (error) {
      const issue = getContentUpdateIssue(error);
      Alert.alert(t(issue.titleKey), t(issue.messageKey));
    } finally {
      setPackBusy(false);
    }
  };

  const busy = backupBusy || restoreBusy || packBusy || notificationBusy;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel>{t('settings.appearance')}</SectionLabel>
        <SettingsGroup>
          <View style={styles.controlBlock}>
            <Text
              style={[typography.footnote, styles.controlLabel, { color: colors.secondaryLabel }]}
            >
              {t('settings.language')}
            </Text>
            <SegmentedControl<LanguagePreference>
              accessibilityLabel={t('settings.language')}
              onChange={(nextLanguage) => {
                if (busy) return;
                setLanguage(nextLanguage);
                const resolvedLanguage: LocalLanguage =
                  nextLanguage === 'en' ? 'en' : nextLanguage === 'tr' ? 'tr' : language;
                void syncNotifications(notificationPrefs, resolvedLanguage);
              }}
              options={[
                { label: t('settings.system'), value: 'system' },
                { label: t('settings.turkish'), value: 'tr' },
                { label: t('settings.english'), value: 'en' },
              ]}
              value={languagePreference}
            />
          </View>
          <View style={[styles.controlBlock, styles.controlBlockLast]}>
            <Text
              style={[typography.footnote, styles.controlLabel, { color: colors.secondaryLabel }]}
            >
              {t('settings.theme')}
            </Text>
            <SegmentedControl<ThemePreference>
              accessibilityLabel={t('settings.theme')}
              onChange={setTheme}
              options={[
                { label: t('settings.system'), value: 'system' },
                { label: t('settings.light'), value: 'light' },
                { label: t('settings.dark'), value: 'dark' },
              ]}
              value={themePreference}
            />
          </View>
        </SettingsGroup>

        <SectionLabel>{t('settings.exam')}</SectionLabel>
        <SettingsGroup>
          <View style={styles.controlBlock}>
            <Text
              style={[typography.footnote, styles.controlLabel, { color: colors.secondaryLabel }]}
            >
              {t('settings.examYear')}
            </Text>
            <SegmentedControl
              accessibilityLabel={t('settings.examYear')}
              onChange={(year) => {
                if (busy) return;
                if (year === 'automatic') {
                  const nextYear = resolveExamYear(examYear, 'automatic', calendarPack.events);
                  setAutomaticExamYear(nextYear);
                  void syncNotifications(notificationPrefs, language, nextYear);
                  return;
                }
                const nextYear = Number(year);
                setExamYear(nextYear);
                void syncNotifications(notificationPrefs, language, nextYear);
              }}
              options={yearOptions}
              value={examYearMode === 'automatic' ? 'automatic' : String(examYear)}
            />
          </View>
          <View style={styles.controlBlock}>
            <Text
              style={[typography.footnote, styles.controlLabel, { color: colors.secondaryLabel }]}
            >
              {t('settings.targetType')}
            </Text>
            <SegmentedControl<ScoreType>
              accessibilityLabel={t('settings.targetType')}
              onChange={setTargetScoreType}
              options={[
                { label: 'SAY', value: 'say' },
                { label: 'EA', value: 'ea' },
                { label: language === 'en' ? 'VERBAL' : 'SÖZ', value: 'soz' },
                { label: language === 'en' ? 'LANG' : 'DİL', value: 'dil' },
              ]}
              value={targetScoreType}
            />
          </View>
          <View style={styles.numberFields}>
            <NumberInput
              key={`target-net-${targetNet}`}
              label={t('settings.targetNet')}
              max={120}
              min={0}
              onCommit={setTargetNet}
              suffix="/ 120"
              value={targetNet}
            />
            <NumberInput
              key={`diploma-${diplomaNote}`}
              label={t('settings.diploma')}
              max={100}
              min={50}
              onCommit={setDiplomaNote}
              suffix="/ 100"
              value={diplomaNote}
            />
          </View>
        </SettingsGroup>

        <SectionLabel>{t('settings.notifications')}</SectionLabel>
        <SettingsGroup>
          <SettingRow
            detail={local('Her gün seçtiğin saatte', 'Every day at your chosen time')}
            icon="notifications-active"
            label={t('settings.dailyReminder')}
            right={
              notificationBusy ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Switch
                  accessibilityLabel={t('settings.dailyReminder')}
                  disabled={busy}
                  onValueChange={(dailyEnabled) =>
                    void syncNotifications({ ...notificationPrefs, dailyEnabled })
                  }
                  thumbColor={colors.onBrand}
                  trackColor={{ false: colors.separator, true: colors.brand }}
                  value={notificationPrefs.dailyEnabled}
                />
              )
            }
          />
          <SettingRow
            disabled={!notificationPrefs.dailyEnabled || busy}
            icon="schedule"
            label={t('settings.reminderTime')}
            right={
              <TimeControl
                disabled={!notificationPrefs.dailyEnabled || busy}
                language={language}
                onChange={(next) => void syncNotifications(next)}
                preferences={notificationPrefs}
              />
            }
          />
          <SettingRow
            detail={local('Yalnız doğrulanmış resmi tarihler', 'Verified official dates only')}
            icon="event-available"
            label={t('settings.dateAlerts')}
            last
            right={
              <Switch
                accessibilityLabel={t('settings.dateAlerts')}
                disabled={busy}
                onValueChange={(dateAlertsEnabled) =>
                  void syncNotifications({ ...notificationPrefs, dateAlertsEnabled })
                }
                thumbColor={colors.onBrand}
                trackColor={{ false: colors.separator, true: colors.brand }}
                value={notificationPrefs.dateAlertsEnabled}
              />
            }
          />
        </SettingsGroup>

        <SectionLabel>{t('settings.data')}</SectionLabel>
        <SettingsGroup>
          <SettingRow
            detail={local('Ayarlar ve tüm ilerleme verileri', 'Settings and all progress data')}
            disabled={!ready || busy}
            icon="ios-share"
            label={t('settings.backup')}
            onPress={() => void exportBackup()}
            right={backupBusy ? <ActivityIndicator color={colors.brand} /> : undefined}
          />
          <SettingRow
            detail={local('JSON yedek dosyası seç', 'Choose a JSON backup file')}
            disabled={busy}
            icon="settings-backup-restore"
            label={t('settings.restore')}
            last
            onPress={() => void chooseBackup()}
            right={restoreBusy ? <ActivityIndicator color={colors.brand} /> : undefined}
          />
        </SettingsGroup>

        <SectionLabel>{t('settings.content')}</SectionLabel>
        <SettingsGroup>
          <SettingRow
            detail={packStatusDetail}
            disabled={busy}
            icon="cloud-download"
            label={t('settings.updateNow')}
            last
            onPress={() => void updatePack()}
            right={packBusy ? <ActivityIndicator color={colors.brand} /> : undefined}
          />
        </SettingsGroup>

        <SectionLabel>{t('settings.about')}</SectionLabel>
        <SettingsGroup>
          <View style={styles.legalBlock}>
            <View style={styles.aboutTitleRow}>
              <View style={[styles.aboutIcon, { backgroundColor: colors.brand }]}>
                <MaterialIcons color={colors.onBrand} name="school" size={26} />
              </View>
              <View style={styles.rowText}>
                <Text style={[typography.headline, { color: colors.label }]}>YKS Hazırlık</Text>
                <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
                  v{Constants.expoConfig?.version ?? '1.0.0'} · offline-first
                </Text>
              </View>
            </View>
            <Text style={[typography.footnote, styles.legalText, { color: colors.secondaryLabel }]}>
              {t('settings.privacy')}
            </Text>
            <Text style={[typography.footnote, styles.legalText, { color: colors.secondaryLabel }]}>
              {t('settings.disclaimer')}
            </Text>
            <Text style={[typography.footnote, styles.legalText, { color: colors.secondaryLabel }]}>
              {t('settings.licenses')}
            </Text>
            <View style={styles.sourceButtons}>
              <Button
                onPress={() =>
                  void Linking.openURL('https://www.osym.gov.tr').catch(() =>
                    Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
                  )
                }
                title="ÖSYM"
                variant="secondary"
              />
              <Button
                onPress={() =>
                  void Linking.openURL('https://yokatlas.yok.gov.tr').catch(() =>
                    Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
                  )
                }
                title="YÖK Atlas"
                variant="secondary"
              />
            </View>
          </View>
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 44 },
  sectionLabel: {
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  group: { borderWidth: StyleSheet.hairlineWidth, marginBottom: 10, overflow: 'hidden' },
  controlBlock: { paddingHorizontal: 14, paddingTop: 14 },
  controlBlockLast: { paddingTop: 2 },
  controlLabel: { fontWeight: '600', marginBottom: 7 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginLeft: 14,
    minHeight: 58,
    paddingBottom: 8,
    paddingRight: 14,
    paddingTop: 8,
  },
  rowIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  rowText: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.45 },
  numberFields: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingBottom: 14 },
  numberField: { flex: 1, minWidth: 0, gap: 6 },
  numberInputRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  numberInput: {
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    fontWeight: '700',
    minHeight: 46,
    paddingHorizontal: 11,
    textAlign: 'center',
  },
  timeWrap: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  timeButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  legalBlock: { gap: 12, padding: 16 },
  aboutTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  aboutIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  legalText: { lineHeight: 19 },
  sourceButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});

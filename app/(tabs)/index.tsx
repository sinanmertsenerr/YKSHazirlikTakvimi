import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Card, Chip, EmptyState, ProgressBar, Screen, Stat } from '@/components/ui';
import { allSubjects, calendarPack, useContentRevisionStore } from '@/data/content';
import { istanbulDay } from '@/db/repository';
import { calculateStreak } from '@/features/home/metrics';
import { totalExamNet } from '@/features/progress/calculations';
import { useAppData } from '@/providers/AppDataProvider';
import { useSettingsStore } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';
import { daysUntil, formatDateOnly, formatInstantDate, formatNumber } from '@/utils/format';
import { allowedOsymHttpsUrl } from '@/utils/officialUrls';

export default function HomeScreen() {
  useContentRevisionStore((state) => state.revision);
  const { t, i18n } = useTranslation();
  const { colors, dark, radii, typography } = useTheme();
  const router = useRouter();
  const { activityDays, exams, progress } = useAppData();
  const examYear = useSettingsStore((state) => state.examYear);
  const language = i18n.language === 'en' ? 'en' : 'tr';
  const today = istanbulDay();
  const progressByTopicId = useMemo(
    () => new Map(progress.map((item) => [item.topicId, item] as const)),
    [progress],
  );
  const streak = calculateStreak(
    activityDays.map((item) => item.day),
    today,
  );
  const todayActivity = activityDays.find((item) => item.day === today);
  const todayQuestions = todayActivity?.questions ?? 0;
  const todayTopics = todayActivity?.topicCount ?? 0;

  const allExamEvents = calendarPack.events
    .filter((event) => event.type === 'sinav')
    .sort((a, b) => a.start.localeCompare(b.start));
  const effectiveExamYear = examYear;
  const examEvents = allExamEvents.filter((event) =>
    event.start.startsWith(String(effectiveExamYear)),
  );
  const tytDate = examEvents.find((event) => event.id.toLocaleLowerCase('tr').includes('tyt'));
  const aytDate = examEvents.find((event) => event.id.toLocaleLowerCase('tr').includes('ayt'));
  const ydtDate = examEvents.find((event) => event.id.toLocaleLowerCase('tr').includes('ydt'));
  const remaining = tytDate ? daysUntil(tytDate.start) : null;
  const upcoming = calendarPack.events
    .filter((event) => daysUntil(event.start) >= 0)
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  const progressFor = (exam: 'tyt' | 'ayt' | 'ydt') => {
    const subjects = allSubjects(exam);
    const topicKeys = subjects.flatMap((subject) =>
      subject.topics.map((topic) => `${subject.id}:${topic.id}`),
    );
    const done = topicKeys.filter((key) => progressByTopicId.get(key)?.status === 'done').length;
    return topicKeys.length ? done / topicKeys.length : 0;
  };
  const tytProgress = progressFor('tyt');
  const aytProgress = progressFor('ayt');
  const ydtProgress = progressFor('ydt');
  const tytExams = exams.filter((exam) => exam.exam === 'tyt').sort((a, b) => b.date - a.date);
  const lastExam = tytExams[0];
  const previousExam = tytExams[1];
  const difference =
    lastExam && previousExam ? totalExamNet(lastExam) - totalExamNet(previousExam) : null;

  const todayLabel = formatDateOnly(today, language);
  const upcomingSource = allowedOsymHttpsUrl(upcoming?.source);
  const upcomingCard = upcoming ? (
    <Card>
      <View style={styles.row}>
        <MaterialIcons color={colors.warningText} name="event" size={26} />
        <View style={styles.grow}>
          <Text style={[typography.caption, styles.caption, { color: colors.warningText }]}>
            {t('home.upcoming')}
          </Text>
          <Text style={[typography.headline, { color: colors.label, marginTop: 3 }]}>
            {upcoming.title[language]}
          </Text>
          <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>
            {formatDateOnly(upcoming.start, language)} · {daysUntil(upcoming.start)}{' '}
            {t('common.day')}
          </Text>
        </View>
        {upcomingSource ? (
          <MaterialIcons color={colors.tertiaryLabel} name="open-in-new" size={20} />
        ) : null}
      </View>
    </Card>
  ) : null;

  return (
    <Screen>
      <AppHeader
        title={t('home.hello')}
        subtitle={`${todayLabel}${streak ? ` · 🔥 ${t('home.streak', { count: streak })}` : ''}`}
      />

      <LinearGradient
        accessibilityLabel={
          remaining == null ? t('home.noCalendar') : `${remaining} ${t('common.day')}`
        }
        colors={dark ? ['#3730A3', '#6D28D9', '#7E22CE'] : ['#4F46E5', '#7C3AED', '#9333EA']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={[styles.countdown, { borderRadius: radii.hero }]}
      >
        <View style={styles.halo} />
        <Text style={[typography.caption, styles.whiteCaption]}>
          {t('home.untilExam', { year: effectiveExamYear })}
        </Text>
        {remaining == null ? (
          <Text style={[typography.headline, styles.whiteText, styles.missingCalendar]}>
            {t('home.noCalendar')}
          </Text>
        ) : (
          <Text adjustsFontSizeToFit numberOfLines={1} style={styles.days}>
            {remaining} <Text style={styles.daysUnit}>{t('common.day')}</Text>
          </Text>
        )}
        <View style={styles.examRow}>
          {[
            { key: 'TYT', date: tytDate },
            { key: 'AYT', date: aytDate },
            { key: 'YDT', date: ydtDate },
          ].map(({ key, date }) => (
            <View key={key} style={styles.examCol}>
              <Text style={[typography.caption, styles.examLabel]}>{key}</Text>
              <Text
                adjustsFontSizeToFit
                numberOfLines={1}
                style={[typography.footnote, styles.examDate]}
              >
                {date ? formatDateOnly(date.start, language) : '—'}
              </Text>
            </View>
          ))}
        </View>
        {tytDate?.approximate ? (
          <Chip backgroundColor="rgba(255,255,255,0.18)" color="#FFFFFF">
            {t('common.estimated')}
          </Chip>
        ) : null}
      </LinearGradient>

      <View style={styles.stats}>
        <Stat label={t('home.todayQuestions')} value={formatNumber(todayQuestions, language)} />
        <Stat label={t('home.topicsStudied')} value={formatNumber(todayTopics, language)} />
        <Stat
          label={t('home.lastTyt')}
          value={formatNumber(lastExam ? totalExamNet(lastExam) : 0, language)}
        />
      </View>

      <Card>
        <Text style={[typography.headline, { color: colors.label, marginBottom: 12 }]}>
          {t('home.topicProgress')}
        </Text>
        <View style={styles.progressRow}>
          <Chip backgroundColor={colors.tytSoft} color={colors.tytText}>
            TYT
          </Chip>
          <ProgressBar color={colors.tyt} progress={tytProgress} />
          <Text style={[typography.footnote, styles.progressPercent, { color: colors.label }]}>
            %{Math.round(tytProgress * 100)}
          </Text>
        </View>
        <View style={styles.progressRow}>
          <Chip backgroundColor={colors.aytSoft} color={colors.aytText}>
            AYT
          </Chip>
          <ProgressBar color={colors.ayt} progress={aytProgress} />
          <Text style={[typography.footnote, styles.progressPercent, { color: colors.label }]}>
            %{Math.round(aytProgress * 100)}
          </Text>
        </View>
        <View style={styles.progressRow}>
          <Chip backgroundColor={colors.ydtSoft} color={colors.ydtText}>
            YDT
          </Chip>
          <ProgressBar color={colors.ydt} progress={ydtProgress} />
          <Text style={[typography.footnote, styles.progressPercent, { color: colors.label }]}>
            %{Math.round(ydtProgress * 100)}
          </Text>
        </View>
      </Card>

      {lastExam ? (
        <Card>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Text style={[typography.caption, styles.caption, { color: colors.secondaryLabel }]}>
                {t('home.lastExam')} · {formatInstantDate(lastExam.date, language)}
              </Text>
              <Text style={[typography.headline, { color: colors.label, marginTop: 3 }]}>
                {lastExam.publisher || 'TYT'} — {formatNumber(totalExamNet(lastExam), language)}{' '}
                {t('common.net')}
              </Text>
            </View>
            {difference == null ? null : (
              <Chip
                backgroundColor={difference >= 0 ? colors.tytSoft : '#FDECEC'}
                color={difference >= 0 ? colors.successText : colors.danger}
              >
                {difference >= 0 ? '▲' : '▼'} {formatNumber(Math.abs(difference), language)}
              </Chip>
            )}
          </View>
        </Card>
      ) : (
        <EmptyState
          action={{
            title: t('home.firstExam'),
            onPress: () => router.push('/gelisim/deneme/yeni'),
          }}
          body={t('home.firstExamBody')}
          icon="add-chart"
          title={t('home.firstExam')}
        />
      )}

      {upcomingSource && upcomingCard ? (
        <Pressable
          accessibilityHint={t('common.officialSource')}
          accessibilityRole="link"
          onPress={() =>
            void WebBrowser.openBrowserAsync(upcomingSource).catch(() =>
              Alert.alert(t('common.externalLink'), t('common.externalLinkFailed')),
            )
          }
        >
          {upcomingCard}
        </Pressable>
      ) : (
        upcomingCard
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  countdown: { minHeight: 190, padding: 20, marginBottom: 12, overflow: 'hidden', gap: 8 },
  halo: {
    position: 'absolute',
    width: 180,
    height: 180,
    right: -40,
    top: -40,
    borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  whiteCaption: { color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: 0.55 },
  whiteText: { color: '#fff' },
  missingCalendar: { marginVertical: 16 },
  days: { color: '#fff', fontSize: 52, lineHeight: 58, fontWeight: '800', letterSpacing: -1.5 },
  daysUnit: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  examRow: { flexDirection: 'row', gap: 8 },
  examCol: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  examLabel: { color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.5 },
  examDate: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  stats: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressPercent: { minWidth: 38, textAlign: 'right', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  caption: { textTransform: 'uppercase', letterSpacing: 0.55 },
});

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  loadAppData,
  loadUserData,
  removeExam as removeExamFromDb,
  reorderFavorites as reorderFavoritesInDb,
  replaceUserData,
  setFavorite as setFavoriteInDb,
  upsertExam,
  upsertTopicProgress,
} from '@/db/repository';
import type {
  AppDataSnapshot,
  ExamRecord,
  TopicProgressRecord,
  UserDataSnapshot,
} from '@/db/types';
import { useTheme } from '@/theme/useTheme';
import { withPerformancePhase } from '@/utils/performanceDiagnostics';
import { withStartupPhase } from '@/utils/startupDiagnostics';

type AppDataContextValue = AppDataSnapshot & {
  ready: boolean;
  refresh: () => Promise<void>;
  readFullSnapshot: () => Promise<UserDataSnapshot>;
  setTopicProgress: (topicId: string, percent: number) => Promise<void>;
  saveExam: (exam: ExamRecord) => Promise<void>;
  removeExam: (id: string) => Promise<void>;
  setFavorite: (programId: string, favorite: boolean) => Promise<void>;
  reorderFavorites: (ids: string[]) => Promise<void>;
  restoreSnapshot: (snapshot: UserDataSnapshot) => Promise<void>;
};

const empty: AppDataSnapshot = {
  progress: [],
  exams: [],
  favorites: [],
  activityDays: [],
  latestActivity: null,
};
const AppDataContext = createContext<AppDataContextValue | null>(null);

// Diagnosable degradation: the fallback is user-invisible by design (the write already
// committed), but the contract violation itself must leave a trace for dev/QA logs.
function logPatchFallback(mutation: string, error: unknown): void {
  if (process.env.NODE_ENV === 'test') return;
  console.warn('[app-data] mutation patch apply failed, falling back to full refresh', {
    mutation,
    error: error instanceof Error ? error.message : String(error),
  });
}

// The write committed, so the mutation must resolve either way; both failure legs
// (patch apply AND the self-heal refresh) leave a trace instead of vanishing.
async function recoverWithFullRefresh(
  mutation: string,
  error: unknown,
  refresh: () => Promise<void>,
): Promise<void> {
  logPatchFallback(mutation, error);
  await refresh().catch((refreshError: unknown) =>
    logPatchFallback(`${mutation}.refresh`, refreshError),
  );
}

function upsertProgressRecord(
  list: TopicProgressRecord[],
  record: TopicProgressRecord,
): TopicProgressRecord[] {
  const index = list.findIndex((item) => item.topicId === record.topicId);
  if (index === -1) return [...list, record];
  const next = [...list];
  next[index] = record;
  return next;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppDataSnapshot>(empty);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [retrying, setRetrying] = useState(false);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const { t } = useTranslation();
  const { colors, radii, typography } = useTheme();

  const refresh = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const next = await withStartupPhase('user-data.load', () => loadAppData());
      if (!mounted.current || generation !== loadGeneration.current) return;
      setData(next);
      setReady(true);
      setLoadError(null);
    } catch (error) {
      if (mounted.current && generation === loadGeneration.current) {
        setLoadError(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const generation = ++loadGeneration.current;
    void withStartupPhase('user-data.load', () => loadAppData()).then(
      (next) => {
        if (!mounted.current || generation !== loadGeneration.current) return;
        setData(next);
        setReady(true);
        setLoadError(null);
      },
      (error: unknown) => {
        if (!mounted.current || generation !== loadGeneration.current) return;
        setLoadError(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => {
      mounted.current = false;
    };
  }, []);

  const retryInitialLoad = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    setLoadError(null);
    try {
      await refresh();
    } catch {
      // refresh() records the current generation's error for the non-blocking banner.
    } finally {
      setRetrying(false);
    }
  }, [refresh, retrying]);

  const enqueueMutation = useCallback(function enqueueMutation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = mutationQueue.current.catch(() => undefined).then(operation);
    mutationQueue.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  // Applied only AFTER the SQLite write committed. The functional updater is mandatory:
  // queued mutations close over stale renders, so merging into `current` (never the
  // captured `data`) keeps back-to-back patches of different slices from erasing each
  // other. Bumping the generation makes any in-flight full load discard its (pre-write)
  // result instead of overwriting this fresher patch.
  const applyMutationPatch = useCallback(
    (merge: (current: AppDataSnapshot) => AppDataSnapshot) => {
      if (!mounted.current) return;
      loadGeneration.current += 1;
      setData(merge);
      setReady(true);
      setLoadError(null);
    },
    [],
  );

  const value = useMemo<AppDataContextValue>(
    () => ({
      ...data,
      ready,
      refresh,
      readFullSnapshot: () =>
        enqueueMutation(() => withPerformancePhase('user-data.load-full', () => loadUserData())),
      // Every mutation below patches only the slices its write can change (the write
      // itself already re-read them — see repository.ts). A malformed patch must not
      // reject the mutation (the write succeeded); the catch destructures eagerly so
      // that failure degrades to one silent full refresh instead.
      setTopicProgress: (topicId, percent) =>
        enqueueMutation(async () => {
          const patch = await upsertTopicProgress(topicId, percent);
          try {
            const { record, activityDays, latestActivity } = patch;
            applyMutationPatch((current) => ({
              ...current,
              progress: upsertProgressRecord(current.progress, record),
              activityDays,
              latestActivity,
            }));
          } catch (error) {
            await recoverWithFullRefresh('setTopicProgress', error, refresh);
          }
        }),
      saveExam: (exam) =>
        enqueueMutation(async () => {
          const patch = await upsertExam(exam);
          try {
            const { exams, activityDays, latestActivity } = patch;
            applyMutationPatch((current) => ({ ...current, exams, activityDays, latestActivity }));
          } catch (error) {
            await recoverWithFullRefresh('saveExam', error, refresh);
          }
        }),
      removeExam: (id) =>
        enqueueMutation(async () => {
          const patch = await removeExamFromDb(id);
          try {
            const { exams, activityDays, latestActivity } = patch;
            applyMutationPatch((current) => ({ ...current, exams, activityDays, latestActivity }));
          } catch (error) {
            await recoverWithFullRefresh('removeExam', error, refresh);
          }
        }),
      setFavorite: (programId, favorite) =>
        enqueueMutation(async () => {
          const patch = await setFavoriteInDb(programId, favorite);
          try {
            const { favorites } = patch;
            applyMutationPatch((current) => ({ ...current, favorites }));
          } catch (error) {
            await recoverWithFullRefresh('setFavorite', error, refresh);
          }
        }),
      reorderFavorites: (ids) =>
        enqueueMutation(async () => {
          const patch = await reorderFavoritesInDb(ids);
          try {
            const { favorites } = patch;
            applyMutationPatch((current) => ({ ...current, favorites }));
          } catch (error) {
            await recoverWithFullRefresh('reorderFavorites', error, refresh);
          }
        }),
      // Restore rewrites every table; the full reload is the correct (and only) source
      // of truth here, so this stays on refresh() by design.
      restoreSnapshot: (snapshot) =>
        enqueueMutation(async () => {
          await replaceUserData(snapshot);
          await refresh();
        }),
    }),
    [applyMutationPatch, data, enqueueMutation, ready, refresh],
  );

  return (
    <AppDataContext.Provider value={value}>
      <View style={[styles.providerRoot, { backgroundColor: colors.background }]}>
        {loadError ? (
          <View
            accessibilityLiveRegion="assertive"
            style={[
              styles.errorBanner,
              {
                backgroundColor: colors.surface,
                borderColor: colors.danger,
                borderRadius: radii.button,
              },
            ]}
          >
            <Text style={[typography.body, styles.loadMessage, { color: colors.label }]}>
              {t('common.dataLoadFailed')}
            </Text>
            <Pressable
              accessibilityLabel={t('common.retry')}
              accessibilityRole="button"
              accessibilityState={{ disabled: retrying }}
              disabled={retrying}
              onPress={() => void retryInitialLoad()}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: colors.brand, borderRadius: radii.button },
                pressed && styles.pressed,
                retrying && styles.disabled,
              ]}
            >
              {retrying ? <ActivityIndicator color={colors.onBrand} size="small" /> : null}
              <Text style={[typography.headline, { color: colors.onBrand }]}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.providerContent}>{children}</View>
      </View>
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside AppDataProvider');
  return value;
}

const styles = StyleSheet.create({
  providerRoot: { flex: 1 },
  providerContent: { flex: 1 },
  errorBanner: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 12,
  },
  loadMessage: { flex: 1, minWidth: 0 },
  retryButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
  },
  pressed: { opacity: 0.66 },
  disabled: { opacity: 0.45 },
});

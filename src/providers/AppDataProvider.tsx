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
  loadUserData,
  removeExam as removeExamFromDb,
  reorderFavorites as reorderFavoritesInDb,
  replaceUserData,
  setFavorite as setFavoriteInDb,
  upsertExam,
  upsertTopicProgress,
} from '@/db/repository';
import type { ExamRecord, UserDataSnapshot } from '@/db/types';
import { useTheme } from '@/theme/useTheme';
import { withStartupPhase } from '@/utils/startupDiagnostics';

type AppDataContextValue = UserDataSnapshot & {
  ready: boolean;
  refresh: () => Promise<void>;
  setTopicProgress: (topicId: string, percent: number) => Promise<void>;
  saveExam: (exam: ExamRecord) => Promise<void>;
  removeExam: (id: string) => Promise<void>;
  setFavorite: (programId: string, favorite: boolean) => Promise<void>;
  reorderFavorites: (ids: string[]) => Promise<void>;
  restoreSnapshot: (snapshot: UserDataSnapshot) => Promise<void>;
};

const empty: UserDataSnapshot = { progress: [], exams: [], favorites: [], activities: [] };
const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<UserDataSnapshot>(empty);
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
      const next = await withStartupPhase('user-data.load', () => loadUserData());
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
    void withStartupPhase('user-data.load', () => loadUserData()).then(
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

  const value = useMemo<AppDataContextValue>(
    () => ({
      ...data,
      ready,
      refresh,
      setTopicProgress: (topicId, percent) =>
        enqueueMutation(async () => {
          await upsertTopicProgress(topicId, percent);
          await refresh();
        }),
      saveExam: (exam) =>
        enqueueMutation(async () => {
          await upsertExam(exam);
          await refresh();
        }),
      removeExam: (id) =>
        enqueueMutation(async () => {
          await removeExamFromDb(id);
          await refresh();
        }),
      setFavorite: (programId, favorite) =>
        enqueueMutation(async () => {
          await setFavoriteInDb(programId, favorite);
          await refresh();
        }),
      reorderFavorites: (ids) =>
        enqueueMutation(async () => {
          await reorderFavoritesInDb(ids);
          await refresh();
        }),
      restoreSnapshot: (snapshot) =>
        enqueueMutation(async () => {
          await replaceUserData(snapshot);
          await refresh();
        }),
    }),
    [data, enqueueMutation, ready, refresh],
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

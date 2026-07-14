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
import type { ExamRecord, TopicStatus, UserDataSnapshot } from '@/db/types';
import { useTheme } from '@/theme/useTheme';

type AppDataContextValue = UserDataSnapshot & {
  ready: boolean;
  refresh: () => Promise<void>;
  setTopicProgress: (
    topicId: string,
    status: TopicStatus,
    confidence: number | null,
  ) => Promise<void>;
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
  const { t } = useTranslation();
  const { colors, radii, typography } = useTheme();

  const refresh = useCallback(async () => {
    const next = await loadUserData();
    setData(next);
    setReady(true);
    setLoadError(null);
  }, []);

  useEffect(() => {
    let active = true;
    void loadUserData().then(
      (next) => {
        if (!active) return;
        setData(next);
        setReady(true);
        setLoadError(null);
      },
      (error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const retryInitialLoad = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    setLoadError(null);
    try {
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error : new Error(String(error)));
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
      setTopicProgress: (topicId, status, confidence) =>
        enqueueMutation(async () => {
          await upsertTopicProgress(topicId, status, confidence);
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

  if (!ready) {
    if (!loadError) {
      return (
        <View
          accessibilityLabel={t('common.loading')}
          accessibilityRole="progressbar"
          style={[styles.loadState, { backgroundColor: colors.background }]}
        >
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      );
    }
    return (
      <View style={[styles.loadState, { backgroundColor: colors.background }]}>
        <Text
          accessibilityLiveRegion="assertive"
          style={[typography.body, styles.loadMessage, { color: colors.label }]}
        >
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
          {retrying ? <ActivityIndicator color={colors.onBrand} /> : null}
          <Text style={[typography.headline, { color: colors.onBrand }]}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside AppDataProvider');
  return value;
}

const styles = StyleSheet.create({
  loadState: {
    alignItems: 'center',
    flex: 1,
    gap: 18,
    justifyContent: 'center',
    padding: 24,
  },
  loadMessage: { maxWidth: 420, textAlign: 'center' },
  retryButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 160,
    paddingHorizontal: 18,
  },
  pressed: { opacity: 0.66 },
  disabled: { opacity: 0.45 },
});

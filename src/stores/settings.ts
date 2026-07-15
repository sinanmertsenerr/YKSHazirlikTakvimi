import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { currentIstanbulYear, type ExamYearMode } from '@/features/calendar/examYear';

export type LanguagePreference = 'system' | 'tr' | 'en';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ScoreType = 'say' | 'ea' | 'soz' | 'dil';

const SCORE_TYPES: readonly ScoreType[] = ['say', 'ea', 'soz', 'dil'];

export type NotificationPreferences = {
  dailyEnabled: boolean;
  dateAlertsEnabled: boolean;
  hour: number;
  minute: number;
};

export type SettingsState = {
  language: LanguagePreference;
  theme: ThemePreference;
  examYear: number;
  examYearMode: ExamYearMode;
  targetScoreType: ScoreType;
  targetNet: number;
  diplomaNote: number;
  notificationPrefs: NotificationPreferences;
  lastPackCheckTs: number | null;
  activePackVersion: string;
  setLanguage: (language: LanguagePreference) => void;
  setTheme: (theme: ThemePreference) => void;
  setExamYear: (examYear: number) => void;
  setAutomaticExamYear: (examYear: number) => void;
  setTargetScoreType: (targetScoreType: ScoreType) => void;
  setTargetNet: (targetNet: number) => void;
  setDiplomaNote: (diplomaNote: number) => void;
  setNotificationPrefs: (notificationPrefs: Partial<NotificationPreferences>) => void;
  setPackState: (activePackVersion: string, lastPackCheckTs: number) => void;
  replaceSettings: (settings: SettingsSnapshot) => void;
};

export type SettingsSnapshot = Pick<
  SettingsState,
  | 'language'
  | 'theme'
  | 'examYear'
  | 'examYearMode'
  | 'targetScoreType'
  | 'targetNet'
  | 'diplomaNote'
  | 'notificationPrefs'
  | 'lastPackCheckTs'
  | 'activePackVersion'
>;

const mmkv = createMMKV({ id: 'yks.settings' });
const storage = {
  getItem: (name: string) => mmkv.getString(name) ?? null,
  setItem: (name: string, value: string) => mmkv.set(name, value),
  removeItem: (name: string) => mmkv.remove(name),
};

export function migratePersistedSettings(
  persisted: unknown,
  version: number,
): Record<string, unknown> {
  const state: Record<string, unknown> =
    persisted && typeof persisted === 'object' ? { ...persisted } : {};
  // A persisted score type from a build with a different ScoreType union must not survive
  // rehydration as an unknown string; reset it to the default instead.
  if (!SCORE_TYPES.includes(state.targetScoreType as ScoreType)) {
    state.targetScoreType = 'say';
  }
  // Older builds did not record whether examYear came from the default or a user action. Preserve
  // that value as manual rather than risking an explicit selection during migration.
  return version < 1 ? { ...state, examYearMode: 'manual' } : state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: 'system',
      theme: 'system',
      examYear: currentIstanbulYear(),
      examYearMode: 'automatic',
      targetScoreType: 'say',
      targetNet: 95,
      diplomaNote: 80,
      notificationPrefs: {
        dailyEnabled: false,
        dateAlertsEnabled: false,
        hour: 19,
        minute: 0,
      },
      lastPackCheckTs: null,
      activePackVersion: 'bundled',
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setExamYear: (examYear) => set({ examYear, examYearMode: 'manual' }),
      setAutomaticExamYear: (examYear) => set({ examYear, examYearMode: 'automatic' }),
      setTargetScoreType: (targetScoreType) => set({ targetScoreType }),
      setTargetNet: (targetNet) => set({ targetNet }),
      setDiplomaNote: (diplomaNote) => set({ diplomaNote }),
      setNotificationPrefs: (notificationPrefs) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, ...notificationPrefs },
        })),
      setPackState: (activePackVersion, lastPackCheckTs) =>
        set({ activePackVersion, lastPackCheckTs }),
      replaceSettings: (settings) => set(settings),
    }),
    {
      name: 'settings-v1',
      storage: createJSONStorage(() => storage),
      // v2 forces one migrate() pass so the targetScoreType hygiene guard runs on every
      // install persisted before the ScoreType union changed (zustand skips migrate when
      // the persisted version already matches).
      version: 2,
      migrate: migratePersistedSettings,
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        examYear: state.examYear,
        examYearMode: state.examYearMode,
        targetScoreType: state.targetScoreType,
        targetNet: state.targetNet,
        diplomaNote: state.diplomaNote,
        notificationPrefs: state.notificationPrefs,
        lastPackCheckTs: state.lastPackCheckTs,
        activePackVersion: state.activePackVersion,
      }),
    },
  ),
);

export function getSettingsSnapshot(): SettingsSnapshot {
  const state = useSettingsStore.getState();
  return {
    language: state.language,
    theme: state.theme,
    examYear: state.examYear,
    examYearMode: state.examYearMode,
    targetScoreType: state.targetScoreType,
    targetNet: state.targetNet,
    diplomaNote: state.diplomaNote,
    notificationPrefs: state.notificationPrefs,
    lastPackCheckTs: state.lastPackCheckTs,
    activePackVersion: state.activePackVersion,
  };
}

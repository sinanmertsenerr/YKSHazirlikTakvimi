/* eslint-disable import/first */

const mockLoadAppData = jest.fn();
const mockLoadUserData = jest.fn();
const mockRemoveExam = jest.fn();
const mockReorderFavorites = jest.fn();
const mockReplaceUserData = jest.fn();
const mockSetFavorite = jest.fn();
const mockUpsertExam = jest.fn();
const mockUpsertTopicProgress = jest.fn();

jest.mock('@/db/repository', () => ({
  loadAppData: (...args: unknown[]) => mockLoadAppData(...args),
  loadUserData: (...args: unknown[]) => mockLoadUserData(...args),
  removeExam: (...args: unknown[]) => mockRemoveExam(...args),
  reorderFavorites: (...args: unknown[]) => mockReorderFavorites(...args),
  replaceUserData: (...args: unknown[]) => mockReplaceUserData(...args),
  setFavorite: (...args: unknown[]) => mockSetFavorite(...args),
  upsertExam: (...args: unknown[]) => mockUpsertExam(...args),
  upsertTopicProgress: (...args: unknown[]) => mockUpsertTopicProgress(...args),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      brand: '#00f',
      danger: '#f00',
      label: '#111',
      onBrand: '#fff',
      surface: '#fff',
    },
    radii: { button: 12 },
    typography: { body: {}, headline: {} },
  }),
}));

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';

import type {
  ExamMutationResult,
  FavoritesMutationResult,
  ProgressMutationResult,
} from '@/db/repository';
import type { ExamRecord } from '@/db/types';

import { AppDataProvider, useAppData } from './AppDataProvider';

const emptySnapshot = {
  progress: [],
  exams: [],
  favorites: [],
  activityDays: [],
  latestActivity: null,
};
const emptyFullSnapshot = { progress: [], exams: [], favorites: [], activities: [] };

function ReadyState() {
  const { ready } = useAppData();
  return <Text>{ready ? 'ready' : 'hydrating'}</Text>;
}

function FullSnapshotReader() {
  const { readFullSnapshot } = useAppData();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void readFullSnapshot();
      }}
    >
      <Text>read-full</Text>
    </Pressable>
  );
}

describe('AppDataProvider startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps children visible while initial user data is still hydrating', async () => {
    let resolveLoad: (snapshot: typeof emptySnapshot) => void = () => undefined;
    mockLoadAppData.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const view = await render(
      <AppDataProvider>
        <Text>child-visible</Text>
        <ReadyState />
      </AppDataProvider>,
    );

    expect(view.getByText('child-visible')).toBeTruthy();
    expect(view.getByText('hydrating')).toBeTruthy();

    await act(async () => {
      resolveLoad(emptySnapshot);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText('ready')).toBeTruthy());
  });

  it('shows a non-blocking retry banner after an initial database read failure and recovers', async () => {
    mockLoadAppData
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(emptySnapshot);

    const view = await render(
      <AppDataProvider>
        <Text>child-ready</Text>
        <ReadyState />
      </AppDataProvider>,
    );

    expect(view.getByText('child-ready')).toBeTruthy();
    expect(view.getByText('hydrating')).toBeTruthy();
    expect(await view.findByText('common.dataLoadFailed')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'common.retry' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText('ready')).toBeTruthy());
    expect(view.queryByText('common.dataLoadFailed')).toBeNull();
    expect(mockLoadAppData).toHaveBeenCalledTimes(2);
  });

  it('loads complete raw history only when an explicit full snapshot is requested', async () => {
    mockLoadAppData.mockResolvedValueOnce(emptySnapshot);
    mockLoadUserData.mockResolvedValueOnce(emptyFullSnapshot);
    const view = await render(
      <AppDataProvider>
        <ReadyState />
        <FullSnapshotReader />
      </AppDataProvider>,
    );
    await view.findByText('ready');
    expect(mockLoadUserData).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByRole('button'));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockLoadUserData).toHaveBeenCalledTimes(1));
  });
});

type MutationActions = {
  removeExam: (id: string) => Promise<void>;
  reorderFavorites: (ids: string[]) => Promise<void>;
  saveExam: (exam: ExamRecord) => Promise<void>;
  setFavorite: (programId: string, favorite: boolean) => Promise<void>;
  setTopicProgress: (topicId: string, percent: number) => Promise<void>;
};
let mutationActions: MutationActions | null = null;

function MutationProbe() {
  const {
    exams,
    favorites,
    latestActivity,
    progress,
    removeExam,
    reorderFavorites,
    saveExam,
    setFavorite,
    setTopicProgress,
  } = useAppData();
  // Captured after every render (effect, not render-scope — compiler-safe): the K1
  // test invokes two mutations whose closures both come from the SAME pre-mutation
  // render, then asserts neither patch erased the other.
  useEffect(() => {
    mutationActions = { removeExam, reorderFavorites, saveExam, setFavorite, setTopicProgress };
  });
  return (
    <>
      <Text>{`progress:${progress.map((item) => `${item.topicId}@${item.percent}`).join(',')}`}</Text>
      <Text>{`favorites:${favorites.join(',')}`}</Text>
      <Text>{`exams:${exams.map((exam) => exam.id).join(',')}`}</Text>
      <Text>{`latest:${latestActivity?.id ?? 'none'}`}</Text>
    </>
  );
}

describe('AppDataProvider partial mutation patches', () => {
  const progressPatch = {
    record: {
      topicId: 'tyt:paragraf',
      status: 'working',
      confidence: null,
      percent: 40,
      updatedAt: 7,
    },
    activityDays: [{ day: '2026-07-19', questions: 0, topicCount: 1 }],
    latestActivity: {
      id: 'progress:tyt:paragraf:2026-07-19',
      day: '2026-07-19',
      type: 'progress',
      questions: 0,
      topicId: 'tyt:paragraf',
      createdAt: 7,
    },
  } satisfies ProgressMutationResult;
  const examPatch = {
    exams: [
      { id: 'exam-2', date: 5, exam: 'tyt', publisher: '', notes: '', sections: [] },
    ],
    activityDays: [{ day: '2026-07-18', questions: 35, topicCount: 0 }],
    latestActivity: null,
  } satisfies ExamMutationResult;
  const sampleExam: ExamRecord = {
    id: 'exam-2',
    date: 5,
    exam: 'tyt',
    publisher: '',
    notes: '',
    sections: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mutationActions = null;
    mockLoadAppData.mockResolvedValue(emptySnapshot);
  });

  it('applies the mutation patch without a second full reload', async () => {
    mockUpsertTopicProgress.mockResolvedValue(progressPatch);
    const view = await render(
      <AppDataProvider>
        <MutationProbe />
      </AppDataProvider>,
    );
    await view.findByText('progress:');

    await act(async () => {
      void mutationActions!.setTopicProgress('tyt:paragraf', 40);
      await Promise.resolve();
    });

    await waitFor(() => expect(view.getByText('progress:tyt:paragraf@40')).toBeTruthy());
    expect(view.getByText(`latest:${progressPatch.latestActivity.id}`)).toBeTruthy();
    // The write's own targeted re-read is the only data source: no extra loadAppData.
    expect(mockLoadAppData).toHaveBeenCalledTimes(1);
  });

  it('keeps both patches when different-slice mutations run back to back', async () => {
    mockSetFavorite.mockResolvedValue({ favorites: ['program-1'] });
    mockUpsertTopicProgress.mockResolvedValue(progressPatch);
    const view = await render(
      <AppDataProvider>
        <MutationProbe />
      </AppDataProvider>,
    );
    await view.findByText('favorites:');

    // Both mutations are enqueued in the same tick, so both closures capture the SAME
    // pre-mutation render — the scenario where a captured-snapshot merge loses data.
    await act(async () => {
      const actions = mutationActions!;
      void actions.setFavorite('program-1', true);
      void actions.setTopicProgress('tyt:paragraf', 40);
      await Promise.resolve();
    });

    // Functional setData is what keeps the first patch alive under the second one:
    // with a captured-snapshot merge, the progress patch would erase the favorite.
    await waitFor(() => expect(view.getByText('favorites:program-1')).toBeTruthy());
    expect(view.getByText('progress:tyt:paragraf@40')).toBeTruthy();
    expect(mockLoadAppData).toHaveBeenCalledTimes(1);
  });

  it('falls back to one silent full refresh when a mutation returns a malformed patch', async () => {
    mockUpsertTopicProgress.mockResolvedValue(undefined);
    const view = await render(
      <AppDataProvider>
        <MutationProbe />
      </AppDataProvider>,
    );
    await view.findByText('progress:');

    await act(async () => {
      void mutationActions!.setTopicProgress('tyt:paragraf', 40);
      await Promise.resolve();
    });

    // The write succeeded, so the mutation must not surface an error; the provider
    // self-heals by re-reading the full snapshot instead.
    await waitFor(() => expect(mockLoadAppData).toHaveBeenCalledTimes(2));
    expect(view.queryByText('common.dataLoadFailed')).toBeNull();
  });

  it('updates an already-tracked topic in place instead of appending a duplicate', async () => {
    mockUpsertTopicProgress
      .mockResolvedValueOnce(progressPatch)
      .mockResolvedValueOnce({
        ...progressPatch,
        record: { ...progressPatch.record, percent: 70, updatedAt: 9 },
      } satisfies ProgressMutationResult);
    const view = await render(
      <AppDataProvider>
        <MutationProbe />
      </AppDataProvider>,
    );
    await view.findByText('progress:');

    await act(async () => {
      void mutationActions!.setTopicProgress('tyt:paragraf', 40);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText('progress:tyt:paragraf@40')).toBeTruthy());
    await act(async () => {
      void mutationActions!.setTopicProgress('tyt:paragraf', 70);
      await Promise.resolve();
    });

    // The revise-existing branch of upsertProgressRecord: one entry, latest value.
    await waitFor(() => expect(view.getByText('progress:tyt:paragraf@70')).toBeTruthy());
    expect(view.queryByText(/tyt:paragraf@40/)).toBeNull();
  });

  it.each([
    [
      'saveExam',
      () => {
        mockUpsertExam.mockResolvedValue(examPatch);
        return mutationActions!.saveExam(sampleExam);
      },
    ],
    [
      'removeExam',
      () => {
        mockRemoveExam.mockResolvedValue(examPatch);
        return mutationActions!.removeExam('exam-1');
      },
    ],
    [
      'reorderFavorites',
      () => {
        mockReorderFavorites.mockResolvedValue({
          favorites: ['program-2', 'program-1'],
        } satisfies FavoritesMutationResult);
        return mutationActions!.reorderFavorites(['program-2', 'program-1']);
      },
    ],
  ] as const)('applies the %s patch without a second full reload', async (name, run) => {
    const view = await render(
      <AppDataProvider>
        <MutationProbe />
      </AppDataProvider>,
    );
    await view.findByText('exams:');

    await act(async () => {
      void run();
      await Promise.resolve();
    });

    if (name === 'reorderFavorites') {
      await waitFor(() => expect(view.getByText('favorites:program-2,program-1')).toBeTruthy());
    } else {
      await waitFor(() => expect(view.getByText('exams:exam-2')).toBeTruthy());
      expect(view.getByText('latest:none')).toBeTruthy();
    }
    expect(mockLoadAppData).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['saveExam', mockUpsertExam, () => mutationActions!.saveExam(sampleExam)],
    ['removeExam', mockRemoveExam, () => mutationActions!.removeExam('exam-1')],
    ['setFavorite', mockSetFavorite, () => mutationActions!.setFavorite('program-1', true)],
    [
      'reorderFavorites',
      mockReorderFavorites,
      () => mutationActions!.reorderFavorites(['program-1']),
    ],
  ] as const)(
    'falls back to one full refresh when %s returns a malformed patch',
    async (_name, mock, run) => {
      mock.mockResolvedValue(undefined);
      const view = await render(
        <AppDataProvider>
          <MutationProbe />
        </AppDataProvider>,
      );
      await view.findByText('exams:');

      await act(async () => {
        void run();
        await Promise.resolve();
      });

      await waitFor(() => expect(mockLoadAppData).toHaveBeenCalledTimes(2));
      expect(view.queryByText('common.dataLoadFailed')).toBeNull();
    },
  );

  it('still resolves the mutation when the fallback refresh fails too', async () => {
    mockUpsertTopicProgress.mockResolvedValue(undefined);
    mockLoadAppData
      .mockResolvedValueOnce(emptySnapshot)
      .mockRejectedValueOnce(new Error('database unavailable'));
    const view = await render(
      <AppDataProvider>
        <MutationProbe />
      </AppDataProvider>,
    );
    await view.findByText('progress:');

    // Both failure legs (patch apply AND self-heal refresh) — the mutation promise
    // must still resolve: the SQLite write already committed.
    await act(async () => {
      await expect(mutationActions!.setTopicProgress('tyt:paragraf', 40)).resolves.toBeUndefined();
    });
    expect(mockLoadAppData).toHaveBeenCalledTimes(2);
  });
});

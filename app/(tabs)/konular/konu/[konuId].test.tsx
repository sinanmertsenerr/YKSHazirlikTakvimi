/* eslint-disable import/first */

const mockSetOptions = jest.fn();

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('@/components/charts', () => ({ YearBarChart: () => null }));
jest.mock('@/features/topics/PendingYearBadge', () => ({ PendingYearBadge: () => null }));
jest.mock('expo-router', () => ({
  Redirect: () => null,
  useLocalSearchParams: () => ({ konuId: 'paragraf', dersId: 'tyt-turkce' }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'tr' } }),
}));
jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      brand: '#00f',
      label: '#111',
      success: '#0a0',
      tertiaryLabel: '#999',
      warning: '#fa0',
    },
    radii: { button: 12 },
    typography: { largeTitle: {}, subhead: {} },
  }),
}));
jest.mock('@/providers/AppDataProvider', () => ({
  useAppData: () => ({ progress: [], ready: true, setTopicProgress: jest.fn() }),
}));
jest.mock('@/components/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    AppHeader: () => null,
    Card: ({ children }: { children: unknown }) => <View>{children as never}</View>,
    Chip: () => null,
    Footnote: () => null,
    Screen: ({ children }: { children: unknown }) => <View>{children as never}</View>,
    SectionTitle: ({ children }: { children: unknown }) => <Text>{children as never}</Text>,
    PercentSlider: ({
      onChange,
      onInteractEnd,
    }: {
      onChange: (value: number) => void;
      onInteractEnd: () => void;
    }) => (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          onChange(80);
          onInteractEnd();
        }}
      >
        <Text>slide-and-release</Text>
      </Pressable>
    ),
  };
});

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { TopicProgressEditor } from './[konuId]';

// State flushes and passive effects are asynchronous in this renderer, so every
// interaction below is act-wrapped and asserted via waitFor.
describe('TopicProgressEditor unmount guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  function deferredSave() {
    let rejectSave: (error: Error) => void = () => undefined;
    const save = jest.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectSave = reject;
        }),
    );
    return { save, reject: (error: Error) => rejectSave(error) };
  }

  it('rolls back and alerts when a commit fails while still mounted', async () => {
    const { save, reject } = deferredSave();

    const view = await render(
      <TopicProgressEditor initialPercent={40} progressKey="tyt-turkce:paragraf" save={save} />,
    );

    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'slide-and-release' }));
    });
    await waitFor(() => expect(view.getByText('%80')).toBeTruthy());
    expect(save).toHaveBeenCalledWith('tyt-turkce:paragraf', 80);

    await act(async () => {
      reject(new Error('database unavailable'));
      await Promise.resolve();
    });

    // Mounted failure path: visual rollback to the last persisted value + user alert.
    await waitFor(() => expect(view.getByText('%40')).toBeTruthy());
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the commit fails after the editor unmounted', async () => {
    const { save, reject } = deferredSave();

    const view = await render(
      <TopicProgressEditor initialPercent={40} progressKey="tyt-turkce:paragraf" save={save} />,
    );

    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'slide-and-release' }));
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    await act(async () => {
      view.unmount();
    });
    await act(async () => {
      reject(new Error('database unavailable'));
      await Promise.resolve();
    });

    // The alive-guard swallows the late rejection: no alert after unmount.
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

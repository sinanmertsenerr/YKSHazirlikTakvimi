/* eslint-disable import/first */

const mockPrewarmProgramDatabase = jest.fn();
const mockCancelIdleCallback = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/db/programRepository', () => ({
  prewarmProgramDatabase: (...args: unknown[]) => mockPrewarmProgramDatabase(...args),
}));

jest.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: { targetScoreType: 'say' }) => unknown) =>
    selector({ targetScoreType: 'say' }),
}));

jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: { label: '#111', secondaryLabel: '#666', warningText: '#a60' },
    typography: { body: {} },
  }),
}));

jest.mock('@/components/ui', () => {
  const { Pressable, Text, View } = jest.requireActual(
    'react-native',
  ) as typeof import('react-native');
  return {
    AppHeader: () => null,
    Button: ({ onPress, title }: { onPress: () => void; title: string }) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    Card: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Footnote: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Screen: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    SectionTitle: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
  };
});

import { render, waitFor } from '@testing-library/react-native';
import PreferenceScreen from '../../../app/(tabs)/tercih/index';

describe('PreferenceScreen program database prewarm', () => {
  const originalRequestIdleCallback = globalThis.requestIdleCallback;
  const originalCancelIdleCallback = globalThis.cancelIdleCallback;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrewarmProgramDatabase.mockResolvedValue(undefined);
    globalThis.requestIdleCallback = jest.fn((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    });
    globalThis.cancelIdleCallback = mockCancelIdleCallback;
  });

  afterEach(() => {
    globalThis.requestIdleCallback = originalRequestIdleCallback;
    globalThis.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('starts prewarming after the preference landing interaction completes', async () => {
    await render(<PreferenceScreen />);

    await waitFor(() => expect(mockPrewarmProgramDatabase).toHaveBeenCalledTimes(1));
  });
});

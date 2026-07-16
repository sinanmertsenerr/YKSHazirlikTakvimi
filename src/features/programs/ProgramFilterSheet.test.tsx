/* eslint-disable import/first */

jest.mock('@expo/vector-icons', () => ({
  MaterialIcons: () => null,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      brand: '#00f',
      danger: '#f00',
      label: '#111',
      onBrand: '#fff',
      secondaryLabel: '#666',
      separator: '#ddd',
      surface: '#fff',
    },
    typography: { body: {}, footnote: {} },
  }),
}));

jest.mock('@/components/sheet', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  return {
    Sheet: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
      <View>
        {children}
        {footer}
      </View>
    ),
  };
});

jest.mock('@/components/ui', () => {
  const { Pressable, Text, TextInput, View } = jest.requireActual(
    'react-native',
  ) as typeof import('react-native');
  return {
    Button: ({ onPress, title }: { onPress: () => void; title: string }) => (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    Card: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Chip: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{children}</Text>
      </Pressable>
    ),
    Field: (props: React.ComponentProps<typeof TextInput>) => <TextInput {...props} />,
  };
});

import { fireEvent, render } from '@testing-library/react-native';

import { defaultProgramFilters } from './filters';
import { ProgramFilterSheet } from './ProgramFilterSheet';

describe('ProgramFilterSheet facet state', () => {
  it('shows a retryable error instead of presenting empty facet lists as valid data', async () => {
    const onRetry = jest.fn();
    const view = await render(
      <ProgramFilterSheet
        cities={[]}
        error={new Error('facet read failed')}
        languages={[]}
        loading={false}
        locale="tr"
        onApply={jest.fn()}
        onClose={jest.fn()}
        onRetry={onRetry}
        value={defaultProgramFilters}
        visible
      />,
    );

    expect(view.getByText('preference.filterLoadFailed')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'common.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

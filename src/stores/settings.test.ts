/* eslint-disable import/first */

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: jest.fn(() => null),
    set: jest.fn(),
    remove: jest.fn(),
  }),
}));

import { migratePersistedSettings, useSettingsStore } from './settings';

describe('settings exam year provenance', () => {
  afterEach(() => {
    useSettingsStore.setState({
      examYear: 2027,
      examYearMode: 'automatic',
    });
  });

  it('preserves legacy persisted years as manual choices', () => {
    expect(migratePersistedSettings({ examYear: 2027 }, 0)).toMatchObject({
      examYear: 2027,
      examYearMode: 'manual',
    });
  });

  it('marks a user year action manual and supports an explicit return to automatic mode', () => {
    useSettingsStore.getState().setExamYear(2029);
    expect(useSettingsStore.getState()).toMatchObject({ examYear: 2029, examYearMode: 'manual' });

    useSettingsStore.getState().setAutomaticExamYear(2030);
    expect(useSettingsStore.getState()).toMatchObject({
      examYear: 2030,
      examYearMode: 'automatic',
    });
  });
});

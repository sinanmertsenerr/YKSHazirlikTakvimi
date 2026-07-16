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

describe('persisted score-type hygiene', () => {
  it('resets an unknown persisted targetScoreType to the default', () => {
    expect(migratePersistedSettings({ targetScoreType: 'mf' }, 1)).toMatchObject({
      targetScoreType: 'say',
    });
  });

  it('preserves every valid persisted targetScoreType including dil', () => {
    expect(migratePersistedSettings({ targetScoreType: 'dil' }, 1)).toMatchObject({
      targetScoreType: 'dil',
    });
  });
});

describe('persistent content-pack check telemetry', () => {
  afterEach(() => {
    useSettingsStore.setState({
      activePackVersion: 'bundled',
      lastPackCheckTs: null,
      lastPackSuccessTs: null,
      lastPackFailureTs: null,
      lastPackError: null,
    });
  });

  it('migrates the legacy successful check timestamp without inventing a failure', () => {
    expect(migratePersistedSettings({ lastPackCheckTs: 1234 }, 2)).toMatchObject({
      lastPackCheckTs: 1234,
      lastPackSuccessTs: 1234,
      lastPackFailureTs: null,
      lastPackError: null,
    });
  });

  it('records failures across relaunches and clears them after a successful check', () => {
    useSettingsStore.getState().setPackCheckFailure(2000, '  manifest unavailable  ');
    expect(useSettingsStore.getState()).toMatchObject({
      activePackVersion: 'bundled',
      lastPackCheckTs: 2000,
      lastPackSuccessTs: null,
      lastPackFailureTs: 2000,
      lastPackError: 'manifest unavailable',
    });

    useSettingsStore.getState().setPackCheckSuccess('2026.07.4', 3000);
    expect(useSettingsStore.getState()).toMatchObject({
      activePackVersion: '2026.07.4',
      lastPackCheckTs: 3000,
      lastPackSuccessTs: 3000,
      lastPackFailureTs: null,
      lastPackError: null,
    });
  });

  it('sanitizes corrupt persisted telemetry instead of extending backoff indefinitely', () => {
    expect(
      migratePersistedSettings(
        {
          lastPackCheckTs: -1,
          lastPackSuccessTs: Number.POSITIVE_INFINITY,
          lastPackFailureTs: 'yesterday',
          lastPackError: 'secret detail',
        },
        3,
      ),
    ).toMatchObject({
      lastPackCheckTs: null,
      lastPackSuccessTs: null,
      lastPackFailureTs: null,
      lastPackError: null,
    });
  });
});

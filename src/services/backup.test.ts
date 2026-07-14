/* eslint-disable import/first */

jest.mock('@/stores/settings', () => ({ getSettingsSnapshot: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: 'cache' } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

import { BackupValidationError, parseBackupDocument, parseBackupText } from './backup';

const validBackup = {
  schemaVersion: 1,
  exportedAt: '2026-07-14T12:00:00.000Z',
  appVersion: '1.0.0',
  settings: {
    language: 'tr',
    theme: 'system',
    examYear: 2027,
    targetScoreType: 'say',
    targetNet: 95,
    diplomaNote: 80,
    notificationPrefs: {
      dailyEnabled: true,
      dateAlertsEnabled: true,
      hour: 19,
      minute: 0,
    },
  },
  userData: {
    progress: [
      { topicId: 'paragraf', status: 'working', confidence: 3, updatedAt: 1_700_000_000_000 },
    ],
    exams: [],
    favorites: ['10001'],
    activities: [],
  },
} as const;

describe('backup validation', () => {
  it('returns a typed snapshot for a valid versioned backup', () => {
    expect(parseBackupText(JSON.stringify(validBackup))).toEqual(validBackup);
  });

  it('rejects unsupported versions before any caller mutation', () => {
    expect(() => parseBackupDocument({ ...validBackup, schemaVersion: 2 })).toThrow(
      BackupValidationError,
    );
  });

  it('validates and migrates the legacy version before returning it', () => {
    const { appVersion: _appVersion, ...legacyBackup } = validBackup;
    expect(parseBackupDocument({ ...legacyBackup, schemaVersion: 0 })).toMatchObject({
      schemaVersion: 1,
      appVersion: 'legacy',
      settings: validBackup.settings,
      userData: validBackup.userData,
    });
  });

  it('rejects invalid settings and duplicate user records', () => {
    expect(() =>
      parseBackupDocument({
        ...validBackup,
        settings: { ...validBackup.settings, diplomaNote: 101 },
      }),
    ).toThrow(BackupValidationError);

    expect(() =>
      parseBackupDocument({
        ...validBackup,
        userData: { ...validBackup.userData, favorites: ['10001', '10001'] },
      }),
    ).toThrow(BackupValidationError);
  });

  it('rejects unknown, cross-exam, or incomplete section sets', () => {
    const baseExam = {
      id: 'exam-1',
      date: 1_700_000_000_000,
      exam: 'tyt',
      publisher: '',
      notes: '',
      sections: ['tyt-turkce', 'tyt-sosyal', 'tyt-matematik', 'tyt-fen'].map((sectionId) => ({
        sectionId,
        correct: 0,
        wrong: 0,
        blank: 0,
      })),
    } as const;
    const withExam = (exam: unknown) => ({
      ...validBackup,
      userData: { ...validBackup.userData, exams: [exam] },
    });

    expect(() =>
      parseBackupDocument(
        withExam({
          ...baseExam,
          sections: [...baseExam.sections, { sectionId: 'fake', correct: 40, wrong: 0, blank: 0 }],
        }),
      ),
    ).toThrow(BackupValidationError);
    expect(() =>
      parseBackupDocument(
        withExam({
          ...baseExam,
          sections: [
            ...baseExam.sections,
            { sectionId: 'ayt-matematik', correct: 0, wrong: 0, blank: 0 },
          ],
        }),
      ),
    ).toThrow(BackupValidationError);
    expect(() =>
      parseBackupDocument(withExam({ ...baseExam, sections: baseExam.sections.slice(0, 3) })),
    ).toThrow(BackupValidationError);
    expect(parseBackupDocument(withExam(baseExam)).userData.exams).toHaveLength(1);
  });
});

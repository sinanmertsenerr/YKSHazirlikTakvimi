import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { z } from 'zod';

import { examSections } from '@/data/examStructure';
import type { UserDataSnapshot } from '@/db/types';
import { getSettingsSnapshot, type SettingsSnapshot } from '@/stores/settings';

export const CURRENT_BACKUP_SCHEMA_VERSION = 1 as const;
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

const notificationPreferencesSchema = z
  .object({
    dailyEnabled: z.boolean(),
    dateAlertsEnabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  })
  .strict();

export const settingsSnapshotSchema = z
  .object({
    language: z.enum(['system', 'tr', 'en']),
    theme: z.enum(['system', 'light', 'dark']),
    examYear: z.number().int().min(2026).max(2100),
    targetScoreType: z.enum(['say', 'ea', 'soz']),
    targetNet: z.number().finite().min(0).max(120),
    diplomaNote: z.number().finite().min(50).max(100),
    notificationPrefs: notificationPreferencesSchema,
  })
  .strict();

const topicProgressSchema = z
  .object({
    topicId: z.string().trim().min(1).max(200),
    status: z.enum(['none', 'working', 'done']),
    confidence: z.number().int().min(1).max(5).nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

const examSectionSchema = z
  .object({
    sectionId: z.string().trim().min(1).max(200),
    correct: z.number().int().nonnegative().max(200),
    wrong: z.number().int().nonnegative().max(200),
    blank: z.number().int().nonnegative().max(200),
  })
  .strict();

const examSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    date: z.number().int().nonnegative(),
    exam: z.enum(['tyt', 'ayt']),
    publisher: z.string().max(MAX_BACKUP_BYTES),
    notes: z.string().max(MAX_BACKUP_BYTES),
    sections: z.array(examSectionSchema).max(100),
  })
  .strict()
  .superRefine((exam, context) => {
    const ids = new Set<string>();
    const sectionLimits = new Map(examSections.map((section) => [section.id, section]));
    for (const [index, section] of exam.sections.entries()) {
      if (ids.has(section.sectionId)) {
        context.addIssue({
          code: 'custom',
          path: ['sections', index, 'sectionId'],
          message: 'Duplicate exam section.',
        });
      }
      ids.add(section.sectionId);
      const structure = sectionLimits.get(section.sectionId);
      if (!structure) {
        context.addIssue({
          code: 'custom',
          path: ['sections', index, 'sectionId'],
          message: 'Unknown exam section.',
        });
        continue;
      }
      if (structure.exam !== exam.exam) {
        context.addIssue({
          code: 'custom',
          path: ['sections', index, 'sectionId'],
          message: 'Exam section does not belong to this exam type.',
        });
      }
      if (section.correct + section.wrong + section.blank > structure.questionCount) {
        context.addIssue({
          code: 'custom',
          path: ['sections', index],
          message: 'Exam section exceeds its question count.',
        });
      }
    }
    for (const required of examSections.filter((section) => section.exam === exam.exam)) {
      if (!ids.has(required.id)) {
        context.addIssue({
          code: 'custom',
          path: ['sections'],
          message: `Missing required exam section: ${required.id}.`,
        });
      }
    }
  });

const activitySchema = z
  .object({
    id: z.string().trim().min(1).max(300),
    day: z.iso.date(),
    type: z.enum(['progress', 'exam']),
    questions: z.number().int().nonnegative().max(100_000),
    topicId: z.string().max(200).nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const userDataSnapshotSchema = z
  .object({
    progress: z.array(topicProgressSchema).max(20_000),
    exams: z.array(examSchema).max(10_000),
    favorites: z.array(z.string().trim().min(1).max(200)).max(20_000),
    activities: z.array(activitySchema).max(50_000),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const unique = (values: string[], path: string) => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        if (seen.has(value)) {
          context.addIssue({
            code: 'custom',
            path: [path, index],
            message: `Duplicate ${path} id.`,
          });
        }
        seen.add(value);
      }
    };
    unique(
      snapshot.progress.map((record) => record.topicId),
      'progress',
    );
    unique(
      snapshot.exams.map((record) => record.id),
      'exams',
    );
    unique(snapshot.favorites, 'favorites');
    unique(
      snapshot.activities.map((record) => record.id),
      'activities',
    );
  });

export const backupV1Schema = z
  .object({
    schemaVersion: z.literal(CURRENT_BACKUP_SCHEMA_VERSION),
    exportedAt: z.iso.datetime({ offset: true }),
    appVersion: z.string().trim().min(1).max(100),
    settings: settingsSnapshotSchema,
    userData: userDataSnapshotSchema,
  })
  .strict();

const backupV0Schema = z
  .object({
    schemaVersion: z.literal(0),
    exportedAt: z.iso.datetime({ offset: true }),
    settings: settingsSnapshotSchema,
    userData: userDataSnapshotSchema,
  })
  .strict();

export const backupFileSchema = backupV1Schema;
export type BackupSnapshot = z.infer<typeof backupV1Schema>;

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

function toBackupSnapshot(
  userData: UserDataSnapshot,
  settings: SettingsSnapshot,
  now = new Date(),
): BackupSnapshot {
  const {
    activePackVersion: _activePackVersion,
    examYearMode: _examYearMode,
    lastPackCheckTs: _lastPackCheckTs,
    ...userSettings
  } = settings;
  return backupV1Schema.parse({
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion: Constants.expoConfig?.version ?? 'development',
    settings: userSettings,
    userData,
  });
}

function istanbulDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Creates the versioned JSON backup and opens the native share sheet. */
export async function exportUserBackup(
  userData: UserDataSnapshot,
  settings: SettingsSnapshot = getSettingsSnapshot(),
): Promise<{ file: File; snapshot: BackupSnapshot }> {
  const snapshot = toBackupSnapshot(userData, settings);
  const contents = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (new TextEncoder().encode(contents).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('The backup is larger than 10 MB and cannot be exported safely.');
  }
  const file = new File(Paths.cache, `yks-yedek-${istanbulDate()}.json`);
  file.create({ overwrite: true, intermediates: true });
  file.write(contents);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('File sharing is not available on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'YKS Hazırlık yedeği',
    UTI: 'public.json',
  });
  return { file, snapshot };
}

/** Validates and migrates a parsed backup. Add older-version branches here as schemas evolve. */
export function parseBackupDocument(document: unknown): BackupSnapshot {
  if (!document || typeof document !== 'object') {
    throw new BackupValidationError('The selected file is not a YKS backup.');
  }
  const version = Reflect.get(document, 'schemaVersion');
  if (version === 0) {
    const legacyResult = backupV0Schema.safeParse(document);
    if (!legacyResult.success) {
      throw new BackupValidationError('The legacy backup failed validation.');
    }
    return backupV1Schema.parse({
      ...legacyResult.data,
      schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
      appVersion: 'legacy',
    });
  }
  if (version !== CURRENT_BACKUP_SCHEMA_VERSION) {
    throw new BackupValidationError(`Unsupported backup version: ${String(version ?? 'missing')}.`);
  }
  const result = backupV1Schema.safeParse(document);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue?.path.map(String).join('.') || 'backup';
    throw new BackupValidationError(
      `Invalid ${location}: ${issue?.message ?? 'validation failed'}`,
    );
  }
  return result.data;
}

export function parseBackupText(text: string): BackupSnapshot {
  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch {
    throw new BackupValidationError('The selected file is not valid JSON.');
  }
  return parseBackupDocument(document);
}

/** Opens DocumentPicker and returns data only; applying it remains the confirmed provider action. */
export async function pickAndValidateBackup(): Promise<BackupSnapshot | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new BackupValidationError('No backup file was selected.');
  if (asset.size !== undefined && asset.size > MAX_BACKUP_BYTES) {
    throw new BackupValidationError('The selected backup is larger than 10 MB.');
  }
  const file = new File(asset.uri);
  if (!file.exists) throw new BackupValidationError('The selected backup cannot be read.');
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupValidationError('The selected backup is larger than 10 MB.');
  }
  return parseBackupText(await file.text());
}

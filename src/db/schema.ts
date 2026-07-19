import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const topicProgress = sqliteTable('topic_progress', {
  topicId: text('topic_id').primaryKey(),
  status: text('status', { enum: ['none', 'working', 'done'] })
    .notNull()
    .default('none'),
  confidence: integer('confidence'),
  percent: integer('percent').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const mockExam = sqliteTable('deneme', {
  id: text('id').primaryKey(),
  date: integer('date').notNull(),
  exam: text('exam', { enum: ['tyt', 'ayt', 'ydt'] }).notNull(),
  publisher: text('publisher'),
  notes: text('notes'),
});

export const mockExamNet = sqliteTable(
  'deneme_net',
  {
    examId: text('deneme_id')
      .notNull()
      .references(() => mockExam.id, { onDelete: 'cascade' }),
    sectionId: text('section_id').notNull(),
    correct: integer('correct').notNull(),
    wrong: integer('wrong').notNull(),
    blank: integer('blank').notNull(),
  },
  (table) => [primaryKey({ columns: [table.examId, table.sectionId] })],
);

export const favoriteProgram = sqliteTable('favorite_program', {
  programId: text('program_id').primaryKey(),
  sortOrder: integer('sort_order').notNull(),
  addedAt: integer('added_at').notNull(),
});

export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  day: text('day').notNull(),
  type: text('type', { enum: ['progress', 'exam'] }).notNull(),
  questions: integer('questions').notNull().default(0),
  topicId: text('topic_id'),
  createdAt: integer('created_at').notNull(),
});

export const program = sqliteTable('program', {
  id: text('id').primaryKey(),
  universityTr: text('university_tr').notNull(),
  universityEn: text('university_en').notNull(),
  nameTr: text('name_tr').notNull(),
  nameEn: text('name_en').notNull(),
  cityTr: text('city_tr').notNull(),
  cityEn: text('city_en').notNull(),
  type: text('type', { enum: ['devlet', 'vakif', 'kibris'] }).notNull(),
  // Mirror only — the real pack DDL lives in scripts/build-programs.ts (source of truth).
  scoreType: text('score_type', { enum: ['say', 'ea', 'soz', 'tyt', 'dil', 'yetenek'] }).notNull(),
  scholarship: text('scholarship'),
  language: text('language'),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  source: text('source'),
  // Default mirrors RANKLESS_SORT_SENTINEL (scripts/build-programs.ts) — keep in sync.
  latestMinRankSort: integer('latest_min_rank_sort').notNull().default(99_999_999),
});

export const programYear = sqliteTable(
  'program_year',
  {
    programId: text('program_id')
      .notNull()
      .references(() => program.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    quota: integer('quota'),
    placed: integer('placed'),
    minScore: real('min_score'),
    minRank: integer('min_rank'),
  },
  (table) => [primaryKey({ columns: [table.programId, table.year] })],
);

export const schema = {
  topicProgress,
  mockExam,
  mockExamNet,
  favoriteProgram,
  activityLog,
  program,
  programYear,
};

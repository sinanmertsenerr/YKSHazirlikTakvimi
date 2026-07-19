import type { ActivityRecord, ExamRecord, TopicProgressRecord } from '@/db/types';

import { resolveRecentActivity } from './recentActivity';

const subjects = [
  {
    id: 'tyt-matematik',
    name: { tr: 'Matematik', en: 'Mathematics' },
    topics: [{ id: 'problemler', name: { tr: 'Problemler', en: 'Word Problems' } }],
  },
];
const progress: TopicProgressRecord[] = [
  {
    topicId: 'tyt-matematik:problemler',
    status: 'working',
    confidence: null,
    percent: 60,
    updatedAt: 200,
  },
];
const exams: ExamRecord[] = [
  {
    id: 'exam-1',
    date: 100,
    exam: 'tyt',
    publisher: 'Örnek Yayınları',
    notes: '',
    sections: [],
  },
];

function activity(overrides: Partial<ActivityRecord>): ActivityRecord {
  return {
    id: 'progress:tyt-matematik:problemler:2026-07-19',
    day: '2026-07-19',
    type: 'progress',
    questions: 0,
    topicId: 'tyt-matematik:problemler',
    createdAt: 300,
    ...overrides,
  };
}

describe('resolveRecentActivity', () => {
  it('returns an empty model when no activity exists', () => {
    expect(resolveRecentActivity({ activity: null, exams, progress, subjects })).toEqual({
      kind: 'empty',
    });
  });

  it('resolves a topic activity against current content and progress', () => {
    const result = resolveRecentActivity({ activity: activity({}), exams, progress, subjects });

    expect(result).toMatchObject({
      kind: 'topic',
      createdAt: 300,
      subject: { id: 'tyt-matematik' },
      topic: { id: 'problemler' },
      progress: { percent: 60 },
    });
  });

  it.each([activity({ topicId: null }), activity({ topicId: 'tyt-matematik:unknown' })])(
    'falls back when a topic activity cannot be resolved',
    (latestActivity) => {
      expect(
        resolveRecentActivity({ activity: latestActivity, exams, progress, subjects }),
      ).toEqual({
        kind: 'unresolved',
        createdAt: 300,
      });
    },
  );

  it('falls back when a topic no longer has a current progress record', () => {
    expect(
      resolveRecentActivity({ activity: activity({}), exams, progress: [], subjects }),
    ).toEqual({ kind: 'unresolved', createdAt: 300 });
  });

  it('resolves an exam activity by its stable activity id', () => {
    const result = resolveRecentActivity({
      activity: activity({ id: 'exam:exam-1', type: 'exam', topicId: null }),
      exams,
      progress,
      subjects,
    });

    expect(result).toMatchObject({
      kind: 'exam',
      createdAt: 300,
      exam: { id: 'exam-1', publisher: 'Örnek Yayınları' },
    });
  });

  it.each([
    activity({ id: 'exam-1', type: 'exam', topicId: null }),
    activity({ id: 'exam:', type: 'exam', topicId: null }),
    activity({ id: 'exam:missing', type: 'exam', topicId: null }),
  ])('falls back when an exam activity cannot be resolved', (latestActivity) => {
    expect(resolveRecentActivity({ activity: latestActivity, exams, progress, subjects })).toEqual({
      kind: 'unresolved',
      createdAt: 300,
    });
  });
});

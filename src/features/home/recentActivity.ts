import type { Subject, Topic } from '@/data/content';
import type { ActivityRecord, ExamRecord, TopicProgressRecord } from '@/db/types';

type ActivityTopic = Pick<Topic, 'id' | 'name'>;
type ActivitySubject = Pick<Subject, 'id' | 'name'> & {
  topics: readonly ActivityTopic[];
};

type ResolvedActivityBase = {
  createdAt: number;
};

export type RecentActivity =
  | { kind: 'empty' }
  | (ResolvedActivityBase & { kind: 'unresolved' })
  | (ResolvedActivityBase & {
      kind: 'topic';
      subject: ActivitySubject;
      topic: ActivityTopic;
      progress: TopicProgressRecord;
    })
  | (ResolvedActivityBase & { kind: 'exam'; exam: ExamRecord });

export function resolveRecentActivity({
  activity,
  exams,
  progress,
  subjects,
}: {
  activity: ActivityRecord | null;
  exams: readonly ExamRecord[];
  progress: readonly TopicProgressRecord[];
  subjects: readonly ActivitySubject[];
}): RecentActivity {
  if (!activity) return { kind: 'empty' };

  if (activity.type === 'progress') {
    if (!activity.topicId) return { kind: 'unresolved', createdAt: activity.createdAt };

    const currentProgress = progress.find((item) => item.topicId === activity.topicId);
    for (const subject of subjects) {
      const topic = subject.topics.find((item) => `${subject.id}:${item.id}` === activity.topicId);
      if (topic && currentProgress) {
        return {
          kind: 'topic',
          createdAt: activity.createdAt,
          subject,
          topic,
          progress: currentProgress,
        };
      }
    }
    return { kind: 'unresolved', createdAt: activity.createdAt };
  }

  const examPrefix = 'exam:';
  if (!activity.id.startsWith(examPrefix)) {
    return { kind: 'unresolved', createdAt: activity.createdAt };
  }
  const examId = activity.id.slice(examPrefix.length);
  const exam = examId ? exams.find((item) => item.id === examId) : undefined;
  return exam
    ? { kind: 'exam', createdAt: activity.createdAt, exam }
    : { kind: 'unresolved', createdAt: activity.createdAt };
}

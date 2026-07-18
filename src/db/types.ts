export type TopicStatus = 'none' | 'working' | 'done';

export type TopicProgressRecord = {
  topicId: string;
  status: TopicStatus;
  confidence: number | null;
  percent: number;
  updatedAt: number;
};

export type ExamType = 'tyt' | 'ayt' | 'ydt';

export type ExamSectionRecord = {
  sectionId: string;
  correct: number;
  wrong: number;
  blank: number;
};

export type ExamRecord = {
  id: string;
  date: number;
  exam: ExamType;
  publisher: string;
  notes: string;
  sections: ExamSectionRecord[];
};

export type ActivityRecord = {
  id: string;
  day: string;
  type: 'progress' | 'exam';
  questions: number;
  topicId: string | null;
  createdAt: number;
};

export type ActivityDaySummary = {
  day: string;
  questions: number;
  topicCount: number;
};

export type AppDataSnapshot = {
  progress: TopicProgressRecord[];
  exams: ExamRecord[];
  favorites: string[];
  activityDays: ActivityDaySummary[];
};

export type UserDataSnapshot = {
  progress: TopicProgressRecord[];
  exams: ExamRecord[];
  favorites: string[];
  activities: ActivityRecord[];
};

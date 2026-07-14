import type { ExamType } from '@/db/types';

export type LocalizedText = { tr: string; en: string };

export type ExamSection = {
  id: string;
  exam: ExamType;
  name: LocalizedText;
  questionCount: number;
  shortGroup: 'turkce' | 'sosyal' | 'matematik' | 'fen';
};

export const examSections: ExamSection[] = [
  {
    id: 'tyt-turkce',
    exam: 'tyt',
    name: { tr: 'Türkçe', en: 'Turkish' },
    questionCount: 40,
    shortGroup: 'turkce',
  },
  {
    id: 'tyt-sosyal',
    exam: 'tyt',
    name: { tr: 'Sosyal Bilimler', en: 'Social Sciences' },
    questionCount: 20,
    shortGroup: 'sosyal',
  },
  {
    id: 'tyt-matematik',
    exam: 'tyt',
    name: { tr: 'Temel Matematik', en: 'Basic Mathematics' },
    questionCount: 40,
    shortGroup: 'matematik',
  },
  {
    id: 'tyt-fen',
    exam: 'tyt',
    name: { tr: 'Fen Bilimleri', en: 'Sciences' },
    questionCount: 20,
    shortGroup: 'fen',
  },
  {
    id: 'ayt-edebiyat',
    exam: 'ayt',
    name: { tr: 'Türk Dili ve Edebiyatı', en: 'Turkish Literature' },
    questionCount: 24,
    shortGroup: 'turkce',
  },
  {
    id: 'ayt-tarih-1',
    exam: 'ayt',
    name: { tr: 'Tarih-1', en: 'History-1' },
    questionCount: 10,
    shortGroup: 'sosyal',
  },
  {
    id: 'ayt-cografya-1',
    exam: 'ayt',
    name: { tr: 'Coğrafya-1', en: 'Geography-1' },
    questionCount: 6,
    shortGroup: 'sosyal',
  },
  {
    id: 'ayt-tarih-2',
    exam: 'ayt',
    name: { tr: 'Tarih-2', en: 'History-2' },
    questionCount: 11,
    shortGroup: 'sosyal',
  },
  {
    id: 'ayt-cografya-2',
    exam: 'ayt',
    name: { tr: 'Coğrafya-2', en: 'Geography-2' },
    questionCount: 11,
    shortGroup: 'sosyal',
  },
  {
    id: 'ayt-felsefe-grubu',
    exam: 'ayt',
    name: { tr: 'Felsefe Grubu', en: 'Philosophy Group' },
    questionCount: 12,
    shortGroup: 'sosyal',
  },
  {
    id: 'ayt-din-kulturu',
    exam: 'ayt',
    name: { tr: 'Din Kültürü', en: 'Religious Culture' },
    questionCount: 6,
    shortGroup: 'sosyal',
  },
  {
    id: 'ayt-matematik',
    exam: 'ayt',
    name: { tr: 'Matematik', en: 'Mathematics' },
    questionCount: 40,
    shortGroup: 'matematik',
  },
  {
    id: 'ayt-fizik',
    exam: 'ayt',
    name: { tr: 'Fizik', en: 'Physics' },
    questionCount: 14,
    shortGroup: 'fen',
  },
  {
    id: 'ayt-kimya',
    exam: 'ayt',
    name: { tr: 'Kimya', en: 'Chemistry' },
    questionCount: 13,
    shortGroup: 'fen',
  },
  {
    id: 'ayt-biyoloji',
    exam: 'ayt',
    name: { tr: 'Biyoloji', en: 'Biology' },
    questionCount: 13,
    shortGroup: 'fen',
  },
];

export function sectionsForExam(exam: ExamType) {
  return examSections.filter((section) => section.exam === exam);
}

export function localized(text: LocalizedText, language: string) {
  return language === 'en' ? text.en : text.tr;
}

import type { ExamRecord, ExamSectionRecord } from '@/db/types';
import { calculateNet } from '@/scoring';

export function sectionNet(section: ExamSectionRecord) {
  return calculateNet(section);
}

export function totalExamNet(exam: ExamRecord) {
  return exam.sections.reduce((sum, section) => sum + sectionNet(section), 0);
}

export function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function sectionAverages(exams: ExamRecord[]) {
  const sectionIds = [
    ...new Set(exams.flatMap((exam) => exam.sections.map((section) => section.sectionId))),
  ];
  return sectionIds.map((sectionId) => ({
    sectionId,
    average: average(
      exams.map((exam) => {
        const section = exam.sections.find((item) => item.sectionId === sectionId);
        return section ? sectionNet(section) : 0;
      }),
    ),
  }));
}

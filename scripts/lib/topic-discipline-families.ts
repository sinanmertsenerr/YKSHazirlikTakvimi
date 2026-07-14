const SUBJECT_DISCIPLINE_FAMILIES = [
  ['tyt-turkce', 'ayt-edebiyat'],
  ['tyt-tarih', 'ayt-tarih-1', 'ayt-tarih-2'],
  ['tyt-cografya', 'ayt-cografya-1', 'ayt-cografya-2'],
  ['tyt-felsefe', 'ayt-felsefe-grubu'],
  ['tyt-din-kulturu', 'ayt-din-kulturu'],
  ['tyt-matematik', 'tyt-geometri', 'ayt-matematik', 'ayt-geometri'],
  ['tyt-fizik', 'ayt-fizik'],
  ['tyt-kimya', 'ayt-kimya'],
  ['tyt-biyoloji', 'ayt-biyoloji'],
] as const;

const subjectDisciplineFamily = new Map<string, number>(
  SUBJECT_DISCIPLINE_FAMILIES.flatMap((subjects, familyIndex) =>
    subjects.map((subjectId) => [subjectId, familyIndex] as const),
  ),
);

/** Related tags are evidence-only and may only connect an explicit discipline family. */
export function isAllowedRelatedSubject(
  primarySubjectId: string,
  relatedSubjectId: string,
): boolean {
  const primaryFamily = subjectDisciplineFamily.get(primarySubjectId);
  return (
    primaryFamily !== undefined && primaryFamily === subjectDisciplineFamily.get(relatedSubjectId)
  );
}

import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/components/ui';
import { ExamForm } from '@/features/progress/ExamForm';
import { useAppData } from '@/providers/AppDataProvider';

export default function EditExamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { exams } = useAppData();
  const { t } = useTranslation();
  const exam = exams.find((item) => item.id === id);
  if (!exam) {
    return (
      <Screen>
        <EmptyState body={t('progress.noExamsBody')} icon="quiz" title={t('progress.noExams')} />
      </Screen>
    );
  }
  return <ExamForm existing={exam} />;
}

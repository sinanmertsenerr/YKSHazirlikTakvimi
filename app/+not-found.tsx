import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState, Screen } from '@/components/ui';

export default function NotFound() {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <Screen>
      <EmptyState body={t('common.pageNotFound')} icon="travel-explore" title="404" />
      <Button onPress={() => router.replace('/')} title={t('tabs.home')} />
    </Screen>
  );
}

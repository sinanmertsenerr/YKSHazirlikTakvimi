import { Redirect, useLocalSearchParams } from 'expo-router';

import { findOfficialTopicGroup } from '@/data/content';

/**
 * Compatibility route for URLs persisted by builds that exposed the old official-group screen.
 * The broad group now resolves to its study subject instead of relaunching into a removed route.
 */
export default function LegacyTopicGroupRedirect() {
  const { grupId } = useLocalSearchParams<{ grupId: string }>();
  const group = findOfficialTopicGroup(grupId);

  if (!group) return <Redirect href="/konular" />;
  return (
    <Redirect
      href={{
        pathname: '/konular/[dersId]',
        params: { dersId: group.displaySubjectId },
      }}
    />
  );
}

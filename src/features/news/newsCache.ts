import { newsPack, reloadActiveContent, type NewsItem } from '@/data/content';
import { checkForPackUpdate } from '@/data/packUpdater';

export function readCachedNews(): NewsItem[] {
  // The atomically activated content pack is the only news cache. Keeping a second unversioned
  // MMKV copy could shadow a newer corrected pack indefinitely.
  return newsPack.items;
}

export async function refreshNews(): Promise<NewsItem[]> {
  // Pull-to-refresh uses the signed-by-hash pack transaction instead of trusting a standalone
  // news response. A malformed or partial remote update therefore cannot replace cached news.
  const result = await checkForPackUpdate({ force: true });
  if (result.status === 'failed') throw result.error;
  if (result.status === 'incompatible') {
    throw new Error(`News pack requires app version ${result.manifest.minAppVersion}`);
  }
  if (result.status === 'updated') await reloadActiveContent();
  return newsPack.items;
}

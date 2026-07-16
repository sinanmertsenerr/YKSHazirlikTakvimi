import { classifyContentUpdateError, getContentUpdateIssue } from './contentUpdateError';

describe('content update error presentation', () => {
  it.each([['Content manifest request failed (404).'], ['Remote manifest not found']])(
    'treats an unpublished manifest endpoint as informational: %s',
    (message) => {
      expect(classifyContentUpdateError(message)).toBe('service-not-published');
      expect(getContentUpdateIssue(message)).toEqual({
        code: 'service-not-published',
        titleKey: 'contentUpdate.serviceNotPublishedTitle',
        messageKey: 'contentUpdate.serviceNotPublishedMessage',
        tone: 'info',
      });
    },
  );

  it.each([
    ['Network request failed'],
    ['AbortError: The operation was aborted'],
    ['Request timed out'],
    ['NSURLErrorDomain error -1009'],
    ['Unable to download pack file'],
  ])('classifies transport failures without exposing their raw text: %s', (message) => {
    const issue = getContentUpdateIssue(new Error(message));
    expect(issue.code).toBe('connectivity');
    expect(issue.titleKey).toBe('contentUpdate.connectivityTitle');
    expect(issue.messageKey).toBe('contentUpdate.connectivityMessage');
    expect(JSON.stringify(issue)).not.toContain(message);
  });

  it.each([
    ['SHA-256 hash mismatch'],
    ['Schema validation failed for topics.json'],
    ['manifest.json is not valid JSON'],
    ['SQLite quick_check failed'],
    ['The remote content manifest is incompatible or invalid'],
    ['Downloaded programs database is not a valid SQLite file'],
  ])('classifies rejected or corrupt payloads as integrity failures: %s', (message) => {
    expect(classifyContentUpdateError(message)).toBe('integrity');
  });

  it('uses a stable generic presentation for unrecognized technical details', () => {
    const raw = 'A secure HTTPS content pack URL is not configured.';
    expect(getContentUpdateIssue(raw)).toEqual({
      code: 'unknown',
      titleKey: 'contentUpdate.unknownTitle',
      messageKey: 'contentUpdate.unknownMessage',
      tone: 'error',
    });
    expect(JSON.stringify(getContentUpdateIssue(raw))).not.toContain(raw);
  });
});

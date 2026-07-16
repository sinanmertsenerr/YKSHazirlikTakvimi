export type ContentUpdateIssueCode =
  'service-not-published' | 'connectivity' | 'integrity' | 'unknown';

export type ContentUpdateIssueTone = 'info' | 'warning' | 'error';

export type ContentUpdateIssue = {
  code: ContentUpdateIssueCode;
  messageKey: `contentUpdate.${string}`;
  titleKey: `contentUpdate.${string}`;
  tone: ContentUpdateIssueTone;
};

const ISSUE_PRESENTATIONS: Record<ContentUpdateIssueCode, ContentUpdateIssue> = {
  'service-not-published': {
    code: 'service-not-published',
    titleKey: 'contentUpdate.serviceNotPublishedTitle',
    messageKey: 'contentUpdate.serviceNotPublishedMessage',
    tone: 'info',
  },
  connectivity: {
    code: 'connectivity',
    titleKey: 'contentUpdate.connectivityTitle',
    messageKey: 'contentUpdate.connectivityMessage',
    tone: 'warning',
  },
  integrity: {
    code: 'integrity',
    titleKey: 'contentUpdate.integrityTitle',
    messageKey: 'contentUpdate.integrityMessage',
    tone: 'error',
  },
  unknown: {
    code: 'unknown',
    titleKey: 'contentUpdate.unknownTitle',
    messageKey: 'contentUpdate.unknownMessage',
    tone: 'error',
  },
};

function technicalMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`.trim().toLowerCase();
  return String(error ?? '')
    .trim()
    .toLowerCase();
}

export function classifyContentUpdateError(error: unknown): ContentUpdateIssueCode {
  const message = technicalMessage(error);

  if (
    /\bmanifest\b/.test(message) &&
    (/\b404\b/.test(message) || /\bnot[\s-]?found\b/.test(message))
  ) {
    return 'service-not-published';
  }

  if (
    /\b(network request failed|failed to fetch|fetch failed|offline|internet|timed?[\s-]?out|timeout|abort(?:ed)?|connection|socket|dns|unable to download|download failed)\b/.test(
      message,
    ) ||
    /nsurlerrordomain.*-(?:1001|1003|1004|1005|1006|1009)\b/.test(message)
  ) {
    return 'connectivity';
  }

  if (
    /\b(hash|sha-?256|checksum|integrity|schema|validat(?:e|ed|ion)|invalid|incompatible|not (?:a )?valid|corrupt(?:ed|ion)?|unexpectedly large|size mismatch|byte mismatch|quick_check|broken foreign keys|missing required tables|unverified|unsourced)\b/.test(
      message,
    )
  ) {
    return 'integrity';
  }

  return 'unknown';
}

export function getContentUpdateIssue(error: unknown): ContentUpdateIssue {
  return ISSUE_PRESENTATIONS[classifyContentUpdateError(error)];
}

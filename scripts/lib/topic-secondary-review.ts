import {
  canonicalTopicReviewSchema,
  type CanonicalTopicReview,
  validateCanonicalTopicReview,
} from './topic-review-contract.ts';

export const DEFAULT_SECONDARY_REVIEWER = 'codex-secondary-b';
export const secondaryTopicReviewSchema = canonicalTopicReviewSchema;
export type SecondaryTopicReview = CanonicalTopicReview;

type ValidateSecondaryTopicReviewInput = {
  review: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
  currentDate?: string;
  expectedReviewer?: string;
};

export function validateSecondaryTopicReview({
  review,
  bookletRegistry,
  topicCatalog,
  currentDate,
  expectedReviewer = DEFAULT_SECONDARY_REVIEWER,
}: ValidateSecondaryTopicReviewInput): SecondaryTopicReview {
  return validateCanonicalTopicReview({
    review,
    bookletRegistry,
    topicCatalog,
    ...(currentDate === undefined ? {} : { currentDate }),
    expectedReviewer,
    reviewLabel: 'Secondary',
  }).review;
}

import {
  canonicalTopicReviewSchema,
  type CanonicalTopicReview,
  validateCanonicalTopicReview,
} from './topic-review-contract.ts';

export const primaryTopicReviewSchema = canonicalTopicReviewSchema;
export type PrimaryTopicReview = CanonicalTopicReview;

type ValidatePrimaryTopicReviewInput = {
  review: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
  currentDate?: string;
};

export function validatePrimaryTopicReview({
  review,
  bookletRegistry,
  topicCatalog,
  currentDate,
}: ValidatePrimaryTopicReviewInput): PrimaryTopicReview {
  return validateCanonicalTopicReview({
    review,
    bookletRegistry,
    topicCatalog,
    ...(currentDate === undefined ? {} : { currentDate }),
    reviewLabel: 'Primary',
  }).review;
}

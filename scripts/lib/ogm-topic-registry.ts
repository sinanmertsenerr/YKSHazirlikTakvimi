import { readFile } from 'node:fs/promises';

import { z } from 'zod';

export const OGM_TOPIC_REGISTRY_SCHEMA_VERSION = 1;
export const OGM_TOPIC_FIRST_YEAR = 2018;
/** Lowest last-year MEB has ever published; a new edition only ever raises it. */
export const OGM_TOPIC_MIN_LAST_YEAR = 2025;
export const OGM_TOPIC_MAX_LAST_YEAR = 2100;
export const OGM_TOPIC_SOURCE_HOSTS = [
  'ogmmateryal.eba.gov.tr',
  'ogm-small-cdn.eba.gov.tr',
] as const;

const EXPECTED_SOURCE_LAYOUT = [
  { sourceId: 176299, key: 'tyt', status: 'included' },
  { sourceId: 176295, key: 'ayt-ea', status: 'included' },
  { sourceId: 176296, key: 'ayt-soz', status: 'included' },
  { sourceId: 176297, key: 'ayt-say', status: 'included' },
  { sourceId: 176294, key: 'tyt-dkab', status: 'included' },
  { sourceId: 176293, key: 'ayt-dkab', status: 'included' },
  { sourceId: 176298, key: 'ydt', status: 'included' },
] as const;

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .refine((value) => !/^0{64}$/.test(value), 'sha256 cannot be a placeholder');

export function assertAllowedOgmUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid OGM source URL: ${value}`);
  }

  if (url.protocol !== 'https:') throw new Error('OGM source URL must use HTTPS');
  if (!(OGM_TOPIC_SOURCE_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new Error(`OGM source host is not allowlisted: ${url.hostname}`);
  }
  if (url.username || url.password) throw new Error('OGM source URL cannot contain credentials');
  if (url.port && url.port !== '443') throw new Error('OGM source URL cannot use a custom port');
  if (url.hash) throw new Error('OGM source URL cannot contain a fragment');
  return url.href;
}

const allowedOgmUrlSchema = z.string().superRefine((value, context) => {
  try {
    assertAllowedOgmUrl(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

const expectedObservationSchema = z
  .object({
    bytes: z
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    sha256: sha256Schema,
  })
  .strict();

const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/);

const ogmApiProvenanceSchema = z
  .object({
    contentId: z.int().positive(),
    discoveryUrl: allowedOgmUrlSchema,
    bookObjectId: objectIdSchema,
    bookTitle: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine((title) => /\b2018-20\d{2}\b/.test(title), 'title must state a 2018-20xx span'),
    expectedTestCount: z.int().positive(),
    expectedQuestionCount: z.int().positive(),
    pdfPublicUrl: allowedOgmUrlSchema.nullable(),
    pdfAssociation: z.enum(['resolver-target-match', 'resolver-authoritative']),
  })
  .strict();

const commonSourceFields = {
  sourceId: z.int().positive(),
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  titleTr: z.string().trim().min(1).max(160),
  resolverUrl: allowedOgmUrlSchema,
};

const includedSourceSchema = z
  .object({
    ...commonSourceFields,
    status: z.literal('included'),
    intendedUse: z.literal('topic-label-reference-audit'),
    api: ogmApiProvenanceSchema,
    expected: expectedObservationSchema,
  })
  .strict();

const excludedSourceSchema = z
  .object({
    ...commonSourceFields,
    status: z.literal('excluded'),
    reasonCode: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    reasonTr: z.string().trim().min(1).max(300),
  })
  .strict();

export const ogmTopicSourceSchema = z.discriminatedUnion('status', [
  includedSourceSchema,
  excludedSourceSchema,
]);

export const ogmTopicSourceRegistrySchema = z
  .object({
    schemaVersion: z.literal(OGM_TOPIC_REGISTRY_SCHEMA_VERSION),
    authority: z.literal('MEB OGM'),
    // Date-shaped, not pinned to one day, so a re-verification on any later date validates
    // without a code edit — the audit workflow can refresh this field itself.
    observedAt: z.iso.date(),
    coverage: z
      .object({
        firstYear: z.literal(OGM_TOPIC_FIRST_YEAR),
        lastYear: z.int().min(OGM_TOPIC_MIN_LAST_YEAR).max(OGM_TOPIC_MAX_LAST_YEAR),
      })
      .strict(),
    landingPageUrl: allowedOgmUrlSchema,
    contentPolicy: z
      .object({
        auditOnly: z.literal(true),
        rawPdfStored: z.literal(false),
        questionTextStored: z.literal(false),
        topicMappingsPublished: z.literal(false),
      })
      .strict(),
    sources: z.array(ogmTopicSourceSchema),
  })
  .strict()
  .superRefine((registry, context) => {
    if (registry.landingPageUrl !== 'https://ogmmateryal.eba.gov.tr/yks-cikmis-soru-kitaplari') {
      context.addIssue({
        code: 'custom',
        path: ['landingPageUrl'],
        message: 'landingPageUrl must be the official OGM YKS source collection',
      });
    }
    if (registry.sources.length !== EXPECTED_SOURCE_LAYOUT.length) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: `registry must contain exactly ${EXPECTED_SOURCE_LAYOUT.length} scoped records`,
      });
    }

    const seenIds = new Set<number>();
    const seenKeys = new Set<string>();
    registry.sources.forEach((source, index) => {
      const expected = EXPECTED_SOURCE_LAYOUT[index];
      if (
        !expected ||
        source.sourceId !== expected.sourceId ||
        source.key !== expected.key ||
        source.status !== expected.status
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index],
          message: expected
            ? `expected source ${expected.sourceId}/${expected.key}/${expected.status}`
            : 'unexpected additional source',
        });
      }
      if (seenIds.has(source.sourceId)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'sourceId'],
          message: `duplicate sourceId ${source.sourceId}`,
        });
      }
      if (seenKeys.has(source.key)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'key'],
          message: `duplicate key ${source.key}`,
        });
      }
      seenIds.add(source.sourceId);
      seenKeys.add(source.key);

      if (source.status === 'included') {
        const expectedSpan = `${OGM_TOPIC_FIRST_YEAR}-${registry.coverage.lastYear}`;
        if (!source.api.bookTitle.includes(expectedSpan)) {
          context.addIssue({
            code: 'custom',
            path: ['sources', index, 'api', 'bookTitle'],
            message: `book title must state the registry coverage span ${expectedSpan}`,
          });
        }
      }

      const resolver = new URL(source.resolverUrl);
      if (
        resolver.hostname !== 'ogmmateryal.eba.gov.tr' ||
        resolver.pathname !== `/pdf-goster/${source.sourceId}` ||
        resolver.search
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'resolverUrl'],
          message: 'resolverUrl must exactly match the official OGM pdf-goster source ID',
        });
      }
      if (source.status === 'included') {
        if (source.api.contentId !== source.sourceId) {
          context.addIssue({
            code: 'custom',
            path: ['sources', index, 'api', 'contentId'],
            message: 'API provenance contentId must equal sourceId',
          });
        }
        const discovery = new URL(source.api.discoveryUrl);
        if (
          discovery.hostname !== 'ogmmateryal.eba.gov.tr' ||
          discovery.pathname !== `/icerik-goster/${source.sourceId}` ||
          discovery.search
        ) {
          context.addIssue({
            code: 'custom',
            path: ['sources', index, 'api', 'discoveryUrl'],
            message: 'API discoveryUrl must exactly match the official content ID resolver',
          });
        }
        if (
          source.api.pdfAssociation === 'resolver-target-match' &&
          source.api.pdfPublicUrl === null
        ) {
          context.addIssue({
            code: 'custom',
            path: ['sources', index, 'api', 'pdfPublicUrl'],
            message: 'a resolver-target-match association requires a pinned API PDF URL',
          });
        }
        if (
          source.api.pdfAssociation === 'resolver-authoritative' &&
          source.api.pdfPublicUrl !== null
        ) {
          context.addIssue({
            code: 'custom',
            path: ['sources', index, 'api', 'pdfPublicUrl'],
            message: 'unreliable API PDF associations must not be pinned',
          });
        }
      }
    });
  });

export type OgmTopicSource = z.infer<typeof ogmTopicSourceSchema>;
export type IncludedOgmTopicSource = Extract<OgmTopicSource, { status: 'included' }>;
export type OgmTopicSourceRegistry = z.infer<typeof ogmTopicSourceRegistrySchema>;

export function includedOgmTopicSources(
  registry: OgmTopicSourceRegistry,
): IncludedOgmTopicSource[] {
  return registry.sources.filter(
    (source): source is IncludedOgmTopicSource => source.status === 'included',
  );
}

export async function loadOgmTopicSourceRegistry(path: string): Promise<OgmTopicSourceRegistry> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `could not read OGM topic source registry at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const parsed = ogmTopicSourceRegistrySchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new Error(`invalid OGM topic source registry at ${path}:\n${issues}`);
  }
  return parsed.data;
}

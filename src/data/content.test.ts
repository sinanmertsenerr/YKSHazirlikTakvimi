import calendarJson from '../../content/calendar.json';
import coefficientsJson from '../../content/coefficients.json';
import newsJson from '../../content/news.json';
import rankTablesJson from '../../content/rank-tables.json';
import topicGroupMappingsJson from '../../content/topic-group-mappings.json';
import topicGroupStatisticsJson from '../../content/topic-group-statistics.json';
import topicsJson from '../../content/topics.json';
import {
  calendarSchema,
  coefficientsSchema,
  newsSchema,
  rankTablesSchema,
  topicGroupMappingsSchema,
  topicGroupStatisticsSchema,
  topicsSchema,
} from '../../scripts/lib/content-schemas';

import {
  calendarPack,
  calendarPackSchema,
  commitRuntimeContentTransaction,
  coefficientsPack,
  coefficientsPackSchema,
  newsPack,
  newsPackSchema,
  parseRuntimeContentTransaction,
  rankTablesPack,
  rankTablesPackSchema,
  restoreBundledRuntimeContent,
  topicGroupMappingsPack,
  topicGroupMappingsPackSchema,
  topicGroupStatisticsPack,
  topicGroupStatisticsPackSchema,
  type RuntimeContentInput,
  topicsPack,
  topicsPackSchema,
} from './content';

const validInput = () => ({
  topics: structuredClone(topicsJson),
  coefficients: structuredClone(coefficientsJson),
  rankTables: structuredClone(rankTablesJson),
  calendar: structuredClone(calendarJson),
  news: structuredClone(newsJson),
  topicGroupStatistics: structuredClone(topicGroupStatisticsJson),
  topicGroupMappings: structuredClone(topicGroupMappingsJson),
});

describe('schema-v2 source/runtime parity', () => {
  it('uses the exact build schemas at runtime', () => {
    expect(topicsPackSchema).toBe(topicsSchema);
    expect(coefficientsPackSchema).toBe(coefficientsSchema);
    expect(rankTablesPackSchema).toBe(rankTablesSchema);
    expect(calendarPackSchema).toBe(calendarSchema);
    expect(newsPackSchema).toBe(newsSchema);
    expect(topicGroupStatisticsPackSchema).toBe(topicGroupStatisticsSchema);
    expect(topicGroupMappingsPackSchema).toBe(topicGroupMappingsSchema);
    expect(() => parseRuntimeContentTransaction(validInput())).not.toThrow();
  });

  it('rejects v1 and synthetic legacy coefficient documents', () => {
    const v1 = validInput();
    v1.topics.schemaVersion = 1;
    expect(() => parseRuntimeContentTransaction(v1)).toThrow();

    const synthetic: RuntimeContentInput = validInput();
    synthetic.coefficients = {
      schemaVersion: 1,
      year: 2026,
      base: 100,
      rules: { aytWarningTytRawScoreBelow: 150 },
      scoreTypes: [{ id: 'tyt', netCoefficients: { 'tyt-turkce': 3.32 } }],
    };
    expect(() => parseRuntimeContentTransaction(synthetic)).toThrow();
  });

  it('rejects unavailable rank data with points without mutating live content', () => {
    const previous = {
      topics: topicsPack,
      coefficients: coefficientsPack,
      ranks: rankTablesPack,
      calendar: calendarPack,
      news: newsPack,
      topicGroupStatistics: topicGroupStatisticsPack,
      topicGroupMappings: topicGroupMappingsPack,
    };
    const invalid = validInput();
    invalid.rankTables.tables = [
      { scoreType: 'tyt', points: [{ score: 500, rank: 1 }] },
    ] as never[];

    expect(() => parseRuntimeContentTransaction(invalid)).toThrow();
    expect(topicsPack).toBe(previous.topics);
    expect(coefficientsPack).toBe(previous.coefficients);
    expect(rankTablesPack).toBe(previous.ranks);
    expect(calendarPack).toBe(previous.calendar);
    expect(newsPack).toBe(previous.news);
    expect(topicGroupStatisticsPack).toBe(previous.topicGroupStatistics);
    expect(topicGroupMappingsPack).toBe(previous.topicGroupMappings);
  });

  it('restores bundled live references when downloaded content falls back at runtime', () => {
    const bundled = {
      topics: topicsPack,
      coefficients: coefficientsPack,
      rankTables: rankTablesPack,
      calendar: calendarPack,
      news: newsPack,
      topicGroupStatistics: topicGroupStatisticsPack,
      topicGroupMappings: topicGroupMappingsPack,
    };
    const downloaded = parseRuntimeContentTransaction(validInput());

    commitRuntimeContentTransaction(downloaded);
    expect(topicsPack).toBe(downloaded.topics);
    expect(restoreBundledRuntimeContent()).toBe(true);
    expect(topicsPack).toBe(bundled.topics);
    expect(coefficientsPack).toBe(bundled.coefficients);
    expect(rankTablesPack).toBe(bundled.rankTables);
    expect(calendarPack).toBe(bundled.calendar);
    expect(newsPack).toBe(bundled.news);
    expect(topicGroupStatisticsPack).toBe(bundled.topicGroupStatistics);
    expect(restoreBundledRuntimeContent()).toBe(false);
  });

  it('rejects an available official group that points outside the fine-topic subject catalog', () => {
    const input: RuntimeContentInput = validInput();
    input.topicGroupStatistics = {
      ...structuredClone(topicGroupStatisticsJson),
      availability: 'available',
      verificationMethod: 'official-direct',
      verifiedAt: '2026-07-15T03:00:00+03:00',
      sources: [
        {
          key: 'tyt',
          sourceId: 176299,
          apiBookId: '68b4f30ceb079be0e77092c8',
          titleTr: 'TYT Çıkmış Sorular (2018-2025)',
          resolverUrl: 'https://ogmmateryal.eba.gov.tr/pdf-goster/176299',
          bytes: 35_975_026,
          sha256: 'a'.repeat(64),
        },
      ],
      groups: [
        {
          id: 'unknown-official-group',
          exam: 'tyt',
          displaySubjectId: 'tyt-olmayan-ders',
          sourceKey: 'tyt',
          evidenceMethod: 'official-pdf-table',
          questionSet: 'canonical',
          countingPolicy: 'canonical',
          sourceLabelTr: 'Resmî Grup',
          translationStatus: 'source-only',
          physicalPage: 1,
          displayOrder: 0,
          yearlyCounts: Array.from({ length: 8 }, (_, index) => ({
            year: 2018 + index,
            count: 0,
          })),
          total: 0,
        },
      ],
    };
    expect(() => parseRuntimeContentTransaction(input)).toThrow('mismatched display subject');
  });
});

describe('bundled content module contract', () => {
  it('exposes the bundled packs synchronously at module scope (never a Promise)', () => {
    // The startup-phase wrapper around the module-scope parse must stay synchronous:
    // an async wrapper would silently turn every pack export into undefined/Promise.
    expect(topicsPack).not.toBeInstanceOf(Promise);
    expect(Array.isArray((topicsPack as { exams: unknown[] }).exams)).toBe(true);
    expect(calendarPack).not.toBeInstanceOf(Promise);
    expect(Array.isArray((calendarPack as { events: unknown[] }).events)).toBe(true);
  });
});

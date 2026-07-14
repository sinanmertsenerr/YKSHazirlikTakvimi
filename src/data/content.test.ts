import calendarJson from '../../content/calendar.json';
import coefficientsJson from '../../content/coefficients.json';
import newsJson from '../../content/news.json';
import rankTablesJson from '../../content/rank-tables.json';
import topicsJson from '../../content/topics.json';
import {
  calendarSchema,
  coefficientsSchema,
  newsSchema,
  rankTablesSchema,
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
});

describe('schema-v2 source/runtime parity', () => {
  it('uses the exact build schemas at runtime', () => {
    expect(topicsPackSchema).toBe(topicsSchema);
    expect(coefficientsPackSchema).toBe(coefficientsSchema);
    expect(rankTablesPackSchema).toBe(rankTablesSchema);
    expect(calendarPackSchema).toBe(calendarSchema);
    expect(newsPackSchema).toBe(newsSchema);
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
  });

  it('restores bundled live references when downloaded content falls back at runtime', () => {
    const bundled = {
      topics: topicsPack,
      coefficients: coefficientsPack,
      rankTables: rankTablesPack,
      calendar: calendarPack,
      news: newsPack,
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
    expect(restoreBundledRuntimeContent()).toBe(false);
  });
});

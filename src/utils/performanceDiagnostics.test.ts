import { withPerformancePhase, type PerformancePhaseDiagnostic } from './performanceDiagnostics';

describe('performance diagnostics', () => {
  it('records a privacy-safe successful duration', async () => {
    const events: PerformancePhaseDiagnostic[] = [];
    const times = [10, 24];
    await expect(
      withPerformancePhase('catalog.query-page.search', async () => 42, {
        logger: (event) => events.push(event),
        now: () => times.shift() ?? 24,
      }),
    ).resolves.toBe(42);
    expect(events).toEqual([
      {
        event: 'performance_phase',
        phase: 'catalog.query-page.search',
        status: 'ok',
        durationMs: 14,
      },
    ]);
  });

  it('records only the error class before rethrowing', async () => {
    const events: PerformancePhaseDiagnostic[] = [];
    await expect(
      withPerformancePhase(
        'content.validate.programs',
        async () => {
          throw new TypeError('sensitive detail');
        },
        { logger: (event) => events.push(event), now: () => 1 },
      ),
    ).rejects.toThrow('sensitive detail');
    expect(events[0]).toEqual({
      event: 'performance_phase',
      phase: 'content.validate.programs',
      status: 'error',
      durationMs: 0,
      errorName: 'TypeError',
    });
    expect(events[0]).not.toHaveProperty('errorMessage');
  });
});

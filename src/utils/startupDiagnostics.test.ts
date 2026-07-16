import { logStartupOutcome, withStartupPhase, type StartupDiagnostic } from './startupDiagnostics';

describe('startup diagnostics', () => {
  it('records successful phase timing and returns the operation result', async () => {
    const diagnostics: StartupDiagnostic[] = [];
    const times = [10, 37];

    await expect(
      withStartupPhase('content.load-active', async () => 'loaded', {
        logger: (diagnostic) => diagnostics.push(diagnostic),
        now: () => times.shift() ?? 37,
      }),
    ).resolves.toBe('loaded');

    expect(diagnostics).toEqual([
      {
        event: 'startup_phase',
        phase: 'content.load-active',
        status: 'ok',
        durationMs: 27,
      },
    ]);
  });

  it('records normalized failures and preserves the rejection', async () => {
    const diagnostics: StartupDiagnostic[] = [];
    const failure = new TypeError('database unavailable');

    await expect(
      withStartupPhase('user-data.load', async () => Promise.reject(failure), {
        logger: (diagnostic) => diagnostics.push(diagnostic),
        now: (() => {
          const times = [100, 108];
          return () => times.shift() ?? 108;
        })(),
      }),
    ).rejects.toBe(failure);

    expect(diagnostics).toEqual([
      {
        event: 'startup_phase',
        phase: 'user-data.load',
        status: 'error',
        durationMs: 8,
        errorName: 'TypeError',
        errorMessage: 'database unavailable',
      },
    ]);
  });

  it('records content update outcomes separately from transport timing', () => {
    const diagnostics: StartupDiagnostic[] = [];

    logStartupOutcome('content.update-check', 'failed', '2026.07.3', (diagnostic) =>
      diagnostics.push(diagnostic),
    );

    expect(diagnostics).toEqual([
      {
        event: 'startup_outcome',
        phase: 'content.update-check',
        outcome: 'failed',
        activeVersion: '2026.07.3',
      },
    ]);
  });
});

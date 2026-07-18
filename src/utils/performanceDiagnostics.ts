export type PerformancePhaseDiagnostic = {
  event: 'performance_phase';
  phase: string;
  status: 'ok' | 'error';
  durationMs: number;
  errorName?: string;
};

export type PerformanceDiagnosticLogger = (diagnostic: PerformancePhaseDiagnostic) => void;

const defaultLogger: PerformanceDiagnosticLogger = (diagnostic) => {
  if (process.env.NODE_ENV === 'test') return;
  console.info('[performance]', diagnostic);
};

export async function withPerformancePhase<T>(
  phase: string,
  operation: () => Promise<T>,
  options: {
    logger?: PerformanceDiagnosticLogger;
    now?: () => number;
  } = {},
): Promise<T> {
  const logger = options.logger ?? defaultLogger;
  const now = options.now ?? Date.now;
  const startedAt = now();
  try {
    const result = await operation();
    logger({
      event: 'performance_phase',
      phase,
      status: 'ok',
      durationMs: Math.max(0, Math.round(now() - startedAt)),
    });
    return result;
  } catch (error) {
    logger({
      event: 'performance_phase',
      phase,
      status: 'error',
      durationMs: Math.max(0, Math.round(now() - startedAt)),
      errorName: error instanceof Error ? error.name : 'Error',
    });
    throw error;
  }
}

export type StartupPhaseDiagnostic = {
  event: 'startup_phase';
  phase: string;
  status: 'ok' | 'error';
  durationMs: number;
  errorName?: string;
  errorMessage?: string;
};

export type StartupOutcomeDiagnostic = {
  event: 'startup_outcome';
  phase: string;
  outcome: string;
  activeVersion?: string;
};

export type StartupDiagnostic = StartupPhaseDiagnostic | StartupOutcomeDiagnostic;
export type StartupDiagnosticLogger = (diagnostic: StartupDiagnostic) => void;

const defaultLogger: StartupDiagnosticLogger = (diagnostic) => {
  if (process.env.NODE_ENV === 'test') return;
  console.info('[startup]', diagnostic);
};

export function logStartupOutcome(
  phase: string,
  outcome: string,
  activeVersion?: string,
  logger: StartupDiagnosticLogger = defaultLogger,
): void {
  logger({
    event: 'startup_outcome',
    phase,
    outcome,
    ...(activeVersion ? { activeVersion } : {}),
  });
}

function logPhaseResult(
  logger: StartupDiagnosticLogger,
  phase: string,
  startedAt: number,
  now: () => number,
  error?: unknown,
): void {
  const durationMs = Math.max(0, Math.round(now() - startedAt));
  if (error === undefined) {
    logger({ event: 'startup_phase', phase, status: 'ok', durationMs });
    return;
  }
  const normalized = error instanceof Error ? error : new Error(String(error));
  logger({
    event: 'startup_phase',
    phase,
    status: 'error',
    durationMs,
    errorName: normalized.name,
    errorMessage: normalized.message,
  });
}

/**
 * Synchronous sibling of withStartupPhase for module-scope work that cannot await
 * (e.g. the bundled-content zod parse that runs during module evaluation). Returning
 * the value directly keeps module-scope consumers synchronous — wrapping such work in
 * the async variant would silently turn them into Promises.
 */
export function measureStartupPhaseSync<T>(
  phase: string,
  operation: () => T,
  options: {
    logger?: StartupDiagnosticLogger;
    now?: () => number;
  } = {},
): T {
  const logger = options.logger ?? defaultLogger;
  const now = options.now ?? Date.now;
  const startedAt = now();
  try {
    const result = operation();
    logPhaseResult(logger, phase, startedAt, now);
    return result;
  } catch (error) {
    logPhaseResult(logger, phase, startedAt, now, error);
    throw error;
  }
}

export async function withStartupPhase<T>(
  phase: string,
  operation: () => Promise<T>,
  options: {
    logger?: StartupDiagnosticLogger;
    now?: () => number;
  } = {},
): Promise<T> {
  const logger = options.logger ?? defaultLogger;
  const now = options.now ?? Date.now;
  const startedAt = now();
  try {
    const result = await operation();
    logPhaseResult(logger, phase, startedAt, now);
    return result;
  } catch (error) {
    logPhaseResult(logger, phase, startedAt, now, error);
    throw error;
  }
}

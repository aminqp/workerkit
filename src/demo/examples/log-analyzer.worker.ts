export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  durationMs?: number;
  statusCode?: number;
  userId?: string;
}

export interface LogReport {
  total: number;
  byLevel: Record<LogLevel, number>;
  byService: Record<string, number>;
  errorRate: number;
  avgDurationMs: number;
  slowestRequests: { service: string; durationMs: number; message: string }[];
  topErrors: { message: string; count: number }[];
}

/**
 * Generates a realistic server log dataset.
 */
export function generateLogs({
  data,
}: {
  data: { count: number };
}): LogEntry[] {
  const { count } = data ?? { count: 0 };
  const services = [
    'auth-service',
    'payment-api',
    'user-service',
    'notification',
    'search-engine',
    'cdn',
  ];
  const levels: LogLevel[] = [
    'DEBUG',
    'INFO',
    'INFO',
    'INFO',
    'WARN',
    'ERROR',
    'FATAL',
  ];
  const messages = {
    DEBUG: [
      'Cache miss for key',
      'DB query executed',
      'Token validated',
      'Session refreshed',
    ],
    INFO: [
      'Request completed',
      'User logged in',
      'Payment processed',
      'Email sent',
      'Search indexed',
    ],
    WARN: [
      'High memory usage',
      'Slow query detected',
      'Rate limit approaching',
      'Retry attempt',
    ],
    ERROR: [
      'Connection timeout',
      'Invalid credentials',
      'Payment declined',
      'Service unavailable',
    ],
    FATAL: ['Out of memory', 'Database unreachable', 'Unhandled exception'],
  };

  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const level = levels[Math.floor(Math.random() * levels.length)];
    const service = services[Math.floor(Math.random() * services.length)];
    const msgPool = messages[level];
    const message = msgPool[Math.floor(Math.random() * msgPool.length)];
    const ts = new Date(
      now - (count - i) * 200 - Math.random() * 100,
    ).toISOString();

    return {
      timestamp: ts,
      level,
      service,
      message,
      durationMs:
        level === 'DEBUG' ? undefined : Math.floor(Math.random() * 2000) + 10,
      statusCode: ['INFO', 'DEBUG'].includes(level)
        ? 200
        : level === 'WARN'
          ? 429
          : level === 'ERROR'
            ? 500
            : 503,
      userId:
        Math.random() > 0.3
          ? `user-${Math.floor(Math.random() * 100000)}`
          : undefined,
    };
  });
}

/**
 * Analyses a log chunk and returns an aggregated report.
 * Real-world scenario: off-main-thread log crunching for a monitoring dashboard.
 */
export function analyzeLogs({ data }: { data: LogEntry[] }): LogReport {
  const byLevel = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 };
  const byService: Record<string, number> = {};
  const errorMessages: Record<string, number> = {};
  const durations: number[] = [];
  const slowest: LogReport['slowestRequests'] = [];

  for (const entry of data) {
    byLevel[entry.level]++;
    byService[entry.service] = (byService[entry.service] ?? 0) + 1;

    if (entry.durationMs !== undefined) {
      durations.push(entry.durationMs);
      if (entry.durationMs > 800) {
        slowest.push({
          service: entry.service,
          durationMs: entry.durationMs,
          message: entry.message,
        });
      }
    }

    if (entry.level === 'ERROR' || entry.level === 'FATAL') {
      errorMessages[entry.message] = (errorMessages[entry.message] ?? 0) + 1;
    }
  }

  const total = data.length;
  const errors = byLevel.ERROR + byLevel.FATAL;
  const avgDurationMs = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  const topErrors = Object.entries(errorMessages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));

  slowest.sort((a, b) => b.durationMs - a.durationMs);

  return {
    total,
    byLevel,
    byService,
    errorRate: total ? errors / total : 0,
    avgDurationMs: Math.round(avgDurationMs),
    slowestRequests: slowest.slice(0, 10),
    topErrors,
  };
}

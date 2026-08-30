// @neuron shared.core.logger
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface ConsoleSink {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// @signal createLogger
export function createLogger(minLevel: LogLevel = 'info', sink: ConsoleSink = console): Logger {
  const write = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
      return;
    }
    const line = context === undefined
      ? `[${level}] ${message}`
      : `[${level}] ${message} ${JSON.stringify(context)}`;

    if (level === 'error') {
      sink.error(line);
    } else if (level === 'warn') {
      sink.warn(line);
    } else {
      sink.log(line);
    }
  };

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}

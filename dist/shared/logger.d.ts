export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface Logger {
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
}
interface ConsoleSink {
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
export declare function createLogger(minLevel?: LogLevel, sink?: ConsoleSink): Logger;
export {};

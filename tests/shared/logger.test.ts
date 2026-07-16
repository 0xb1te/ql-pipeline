import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/shared/logger.js';

type SinkMethod = (message: string) => void;
type SinkMock = ReturnType<typeof vi.fn<SinkMethod>>;

function createSink(): { log: SinkMock; warn: SinkMock; error: SinkMock } {
  return { log: vi.fn<SinkMethod>(), warn: vi.fn<SinkMethod>(), error: vi.fn<SinkMethod>() };
}

describe('createLogger', () => {
  it('routes debug/info through sink.log', () => {
    const sink = createSink();
    const logger = createLogger('debug', sink);

    logger.debug('a debug message');
    logger.info('an info message');

    expect(sink.log).toHaveBeenCalledWith('[debug] a debug message');
    expect(sink.log).toHaveBeenCalledWith('[info] an info message');
    expect(sink.warn).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
  });

  it('routes warn through sink.warn and error through sink.error', () => {
    const sink = createSink();
    const logger = createLogger('debug', sink);

    logger.warn('careful');
    logger.error('boom');

    expect(sink.warn).toHaveBeenCalledWith('[warn] careful');
    expect(sink.error).toHaveBeenCalledWith('[error] boom');
  });

  it('suppresses messages below the configured minimum level', () => {
    const sink = createSink();
    const logger = createLogger('warn', sink);

    logger.debug('hidden');
    logger.info('also hidden');
    logger.warn('visible');

    expect(sink.log).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledWith('[warn] visible');
  });

  it('defaults to info level when none is given', () => {
    const sink = createSink();
    const logger = createLogger(undefined, sink);

    logger.debug('hidden by default');
    logger.info('shown by default');

    expect(sink.log).toHaveBeenCalledTimes(1);
    expect(sink.log).toHaveBeenCalledWith('[info] shown by default');
  });

  it('appends JSON-serialized context when provided', () => {
    const sink = createSink();
    const logger = createLogger('debug', sink);

    logger.info('with context', { prNumber: 42, area: 'backend' });

    expect(sink.log).toHaveBeenCalledWith('[info] with context {"prNumber":42,"area":"backend"}');
  });
});

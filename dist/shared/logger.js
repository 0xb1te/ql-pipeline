const LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
// @signal createLogger
export function createLogger(minLevel = 'info', sink = console) {
    const write = (level, message, context) => {
        if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
            return;
        }
        const line = context === undefined
            ? `[${level}] ${message}`
            : `[${level}] ${message} ${JSON.stringify(context)}`;
        if (level === 'error') {
            sink.error(line);
        }
        else if (level === 'warn') {
            sink.warn(line);
        }
        else {
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
//# sourceMappingURL=logger.js.map
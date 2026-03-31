const SHOULD_LOG_DEV = process.env.NODE_ENV === 'development';

function withPrefix(method: string, args: unknown[]): unknown[] {
    const methodToColorMap: Record<string, string> = {
        debug: `#7f8c8d`,
        log: `#2ecc71`,
        warn: `#f39c12`,
        error: `#c0392b`,
    };
    const styles = [
        `background: ${methodToColorMap[method]}`,
        `border-radius: 0.5em`,
        `color: white`,
        `font-weight: bold`,
        `padding: 2px 0.5em`,
    ];

    return ['%cPWA', styles.join(';'), ...args];
}

export function logDebug(...args: unknown[]) {
    if (SHOULD_LOG_DEV) {
        console.debug(...withPrefix('debug', args));
    }
}

export function logInfo(...args: unknown[]) {
    if (SHOULD_LOG_DEV) {
        console.info(...withPrefix('log', args));
    }
}

export function logWarn(...args: unknown[]) {
    console.warn(...withPrefix('warn', args));
}

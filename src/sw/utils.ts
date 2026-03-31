/**
 * Utility functions for the offline/inertia module.
 * Includes logging and response utilities.
 */

import type { LogLevel } from './types/utils.js';

/**
 * Retrieves the ETag from a Response object.
 * The ETag is used for cache validation with conditional requests.
 * @param response - The HTTP response object
 * @returns The ETag header value, or null if not found
 */
export function getResponseEtag(response: Response): string | null {
	return response.headers.get('ETag');
}

/** Whether logging is enabled */
let SHOULD_LOG_DEV: boolean = false;

/**
 * Enables or disables debug logging.
 * @param enabled - Set to true to enable debug logging (intended for development builds)
 */
export function setDebugLogging(enabled: boolean): void {
	SHOULD_LOG_DEV = enabled;
}

/**
 * Color map for console output styling by log level.
 * Follows Workbox's styling convention for consistency.
 */
const METHOD_TO_COLOR_MAP: Record<LogLevel | 'log', string> = {
	debug: '#7f8c8d',
	info: '#2ecc71',
	log: '#2ecc71',
	warn: '#f39c12',
	error: '#c0392b',
};

/**
 * Formats log messages with consistent branding and styling.
 * Prepends an "Inertia Offline" label with appropriate color coding.
 * @param method - The console method name (debug, info, warn, error)
 * @param args - Arguments to log after the prefix
 * @returns Formatted arguments array for console output
 */
function withPrefix(method: LogLevel | 'log', args: any[]): any[] {
	const styles: string[] = [
		`background: ${METHOD_TO_COLOR_MAP[method]}`,
		`border-radius: 0.5em`,
		`color: white`,
		`font-weight: bold`,
		`padding: 2px 0.5em`,
	];

	return ['%cInertia Offline', styles.join(';'), ...args];
}

/**
 * Logs debug messages only during development builds.
 * Useful for detailed offline operation tracing.
 * @param args - Arguments to log (variadic)
 */
export function logDebug(...args: any[]): void {
	if (SHOULD_LOG_DEV) {
		console.debug(...withPrefix('debug', args));
	}
}

/**
 * Logs info messages only during development builds.
 * Used for informational offline operation updates.
 * @param args - Arguments to log (variadic)
 */
export function logInfo(...args: any[]): void {
	if (SHOULD_LOG_DEV) {
		console.info(...withPrefix('info', args));
	}
}

/**
 * Logs warning messages in all builds.
 * Used for issues that don't prevent operation but should be noted.
 * @param args - Arguments to log (variadic)
 */
export function logWarn(...args: any[]): void {
	console.warn(...withPrefix('warn', args));
}

/**
 * Logs error messages in all builds.
 * Used for critical issues that affect offline functionality.
 * @param args - Arguments to log (variadic)
 */
export function logError(...args: any[]): void {
	console.error(...withPrefix('error', args));
}

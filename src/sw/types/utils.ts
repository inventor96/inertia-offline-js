/**
 * Utility types and common type helpers
 */

/** Log level for offline system logging */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Options for logging */
export interface LogOptions {
	/** Whether to include timestamp */
	timestamp?: boolean;
	/** Custom style for console output */
	style?: string;
}

/** Result type for operations that may succeed or fail */
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

/** Function type for building offline HTML pages */
export type OfflineHtmlBuilder = (event: FetchEvent) => string;

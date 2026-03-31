import { Dexie, type Table } from 'dexie';

/**
 * Represents an Inertia page cached for offline use.
 * Each page is uniquely identified by its URL.
 */
export interface InertiaPage {
	/** The unique URL of the page */
	url: string;
	/** The Vue component name for this page */
	component: string | null;
	/** The component props data passed to Inertia */
	props: Record<string, any> | null;
	/** Inertia's page version identifier */
	version: string | null;
	/** Timestamp when this page was saved (milliseconds since epoch) */
	savedAt: number;
	/** ETag header value from the last server response for cache validation */
	etag: string | null;
}

/**
 * Metadata about a route that is cacheable offline.
 * Determines which routes should be pre-fetched and cached.
 */
export interface RouteMeta {
	/** The URL/route path */
	url: string;
	/** Whether this route uses pagination */
	paginated: boolean;
	/** Time-to-live in seconds between refresh checks */
	ttl: number;
}

/**
 * System-level key-value pairs for storing offline metadata.
 * Used for tracking sync state, version info, and other application state.
 */
export interface SystemKey {
	/** Unique identifier for the system property */
	key: string;
	/** The value associated with this key (can be any serializable type) */
	value: any;
}

/**
 * The offline Inertia database extending Dexie with typed table declarations.
 * Stores cached pages, route metadata, and system information for offline PWA support.
 */
export interface OfflineDatabase extends Dexie {
	/** Table for storing cached Inertia pages */
	pages: Table<InertiaPage>;
	/** Table for storing which routes are cacheable */
	routeMeta: Table<RouteMeta>;
	/** Table for storing system metadata */
	system: Table<SystemKey>;
}

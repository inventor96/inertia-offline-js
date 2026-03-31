/**
 * Route types for offline route caching and management.
 */

/** Classification of a request (navigation, Inertia, data fetch, etc.) */
export type RequestType = 'navigation' | 'inertia' | 'data' | 'other' | 'unknown';

/** Result of checking if a route can be cached offline */
export interface CacheabilityCheck {
	/** Whether the route is cacheable */
	cacheable: boolean;
	/** Why it is or isn't cacheable (for logging) */
	reason?: string;
	/** TTL in seconds if cacheable */
	ttl?: number;
	/** Whether the route uses pagination */
	paginated?: boolean;
}

/** Context information about a classified request */
export interface RequestContext {
	/** The full request URL */
	url: string;
	/** The request path (URL without origin) */
	path: string;
	/** HTTP method (typically GET) */
	method: string;
	/** Request type classification */
	type: RequestType;
	/** True if request is same-origin */
	sameOrigin: boolean;
	/** True if this is an Inertia request */
	inertia: boolean;
	/** True if this is a navigation request */
	navigation: boolean;
	/** Accept header value */
	accept: string;
}

/** Callback function type for checking if a route is cacheable */
export type RouteCheckFunction = (url: string) => Promise<boolean> | boolean;

/** Callback function type for sync-only route checking */
export type RouteSyncCheckFunction = (url: string) => boolean;

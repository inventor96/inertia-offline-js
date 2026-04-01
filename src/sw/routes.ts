/**
 * Route management for offline caching.
 * Determines which routes are cacheable and manages route metadata.
 */

import { db } from './db.js';
import { ROUTE_META_PATH } from './constants.js';
import { getResponseEtag, logDebug, logWarn } from './utils.js';
import type { RouteMeta } from './types/db.js';

/** In-memory cache of cacheable route URLs for fast synchronous lookups */
const syncRouteCacheableSet: Set<string> = new Set();

/** Flag indicating whether the sync route cache is ready */
let syncRouteCacheReady: boolean = false;

/**
 * Updates the in-memory sync route cache with a list of routes.
 * Used for fast synchronous cacheability checks without database access.
 * @param routes - list of route metadata to cache
 */
function setSyncRouteCache(routes: RouteMeta[] | null | undefined): void {
	syncRouteCacheableSet.clear();
	for (const route of routes || []) {
		if (route && typeof route.url === 'string') {
			syncRouteCacheableSet.add(route.url);
		}
	}
	syncRouteCacheReady = true;
}

/**
 * Checks if a route is cacheable by querying the database.
 * Async operation; use `isCachableSync` if you need synchronous checking.
 * @param url - The URL of the route to check
 * @returns True if the route is in the cacheable routes list, false otherwise
 */
export async function isCachable(url: string): Promise<boolean> {
	const route = await db.routeMeta.get(url);
	return !!route;
}

/**
 * Synchronously checks if a route is cacheable using an in-memory index.
 * Returns null if the cache isn't ready yet (useful for error handling).
 * @param url - The URL of the route to check
 * @returns True/false if cache is ready, null if cache not initialized
 */
export function isCachableSync(url: string): boolean | null {
	if (!syncRouteCacheReady) {
		return null;
	}

	return syncRouteCacheableSet.has(url);
}

/**
 * Response structure from the offline routes endpoint.
 */
interface RouteListResponse {
	ttl: number;
	routes: RouteMeta[];
}

/**
 * Fetches and caches the list of cacheable routes from the server.
 * Uses ETags for efficient cache validation and conditional requests.
 * Also maintains fetch timestamps for TTL-based cache expiration.
 * @param forceRefresh - If true, bypass cache and fetch fresh from server
 * @returns List of cacheable routes, or empty array if fetch fails
 */
export async function getRouteList(forceRefresh: boolean = false): Promise<RouteMeta[]> {
	try {
		// Get current cache metadata
		const meta = await db.system.get('routeListFetchedAt');
		const ttlMeta = await db.system.get('routeListTTL');
		const now: number = Date.now();

		// If we have a fresh cached route list, return it without fetching
		if (!forceRefresh && meta && meta.value && ttlMeta && ttlMeta.value) {
			const age: number = now - meta.value;
			const ttlMs: number = ttlMeta.value * 1000;
			if (age < ttlMs) {
				const cachedRoutes = await db.routeMeta.toArray();
				setSyncRouteCache(cachedRoutes);
				return cachedRoutes;
			}
		}

		// Build conditional request headers using ETag if available
		const routeListEtag = await db.system.get('routeListETag');
		const headers: Record<string, string> = {};
		if (routeListEtag?.value) {
			headers['If-None-Match'] = routeListEtag.value;
		}

		// Fetch route list from server
		const routeRes = await fetch(ROUTE_META_PATH, {
			credentials: 'include',
			headers,
		});

		// If 304 Not Modified, update timestamp and return cached routes
		if (routeRes.status === 304) {
			await db.system.put({ key: 'routeListFetchedAt', value: now });
			logDebug('Route list not modified');
			const cachedRoutes = await db.routeMeta.toArray();
			setSyncRouteCache(cachedRoutes);
			return cachedRoutes;
		}

		// If request failed, return empty array
		if (!routeRes.ok) {
			logWarn('Failed to fetch route list', routeRes.statusText);
			return [];
		}

		// Parse response
		const response: RouteListResponse = await routeRes.json();
		const { ttl, routes } = response;

		// Clear old routes and store new ones
		await db.routeMeta.clear();
		for (const r of routes) {
			await db.routeMeta.put({
				url: r.url,
				ttl: r.ttl,
			});
		}
		setSyncRouteCache(routes);

		// Store metadata: fetch timestamp, TTL, and ETag for next time
		await db.system.put({ key: 'routeListFetchedAt', value: now });
		await db.system.put({ key: 'routeListTTL', value: ttl || 0 });
		const etag = getResponseEtag(routeRes);
		if (etag) {
			await db.system.put({ key: 'routeListETag', value: etag });
		} else {
			await db.system.delete('routeListETag');
		}

		return routes;
	} catch (err) {
		logWarn('getRouteList failed', err);
		return [];
	}
}

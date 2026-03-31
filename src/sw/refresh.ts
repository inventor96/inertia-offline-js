/**
 * Page refresh and caching operations for offline support.
 * Manages periodic updating of cached pages and templates.
 */

import {
	REFRESH_CONCURRENCY,
	REFRESH_STAGGER,
	DEFAULT_START_URL,
	OFFLINE_TEMPLATE_FETCH_PATH,
	OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
} from './constants.js';
import { getPage, storePage, touchPage } from './pages.js';
import { getRouteList } from './routes.js';
import { ensureInertiaVersion } from './version.js';
import { refreshOfflineTemplate } from './template.js';
import { refreshRootRedirect } from './redirects.js';
import { getResponseEtag, logDebug, logWarn } from './utils.js';
import { clearAllData } from './data.js';
import type { RouteMeta } from './types/db.js';

/**
 * Options for the refresh process.
 */
export interface RefreshOptions {
	/** Path to fetch offline template from (default: '/') */
	templateFetchPath?: string;
	/** CSS selector for the Inertia page element in template (default: '[data-page]') */
	templateElementSelector?: string;
	/** PWA start URL for handling redirects (from manifest.start_url) */
	startUrl?: string;
	/** Maximum number of concurrent page refresh operations (default: 4) */
	refreshConcurrency?: number;
	/** Delay in milliseconds between staggered refresh operations (default: 500) */
	refreshStagger?: number;
}

/**
 * Options for caching individual pages.
 */
interface CachePageOptions {
	/** Whether to retry on Inertia version mismatch (default: true) */
	retryOnVersionMismatch?: boolean;
	/** Inertia version to use for request (null = fetch current) */
	inertiaVersion?: string | null;
}

/**
 * Gets the default refresh options.
 * @returns Object with template and redirect configuration
 */
export function getRefreshOptions(): RefreshOptions {
	return {
		templateFetchPath: OFFLINE_TEMPLATE_FETCH_PATH,
		templateElementSelector: OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
		startUrl: DEFAULT_START_URL,
		refreshConcurrency: REFRESH_CONCURRENCY,
		refreshStagger: REFRESH_STAGGER,
	};
}

/**
 * Refreshes all expired pages, templates, and redirects.
 * Uses concurrency and staggering to avoid overwhelming the server.
 * @param options - Configuration for refresh process
 */
export async function refreshAllExpired(options: RefreshOptions = {}): Promise<void> {
	try {
		// Extract options with defaults
		const {
			templateFetchPath = OFFLINE_TEMPLATE_FETCH_PATH,
			templateElementSelector = OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
			startUrl = DEFAULT_START_URL,
			refreshConcurrency = REFRESH_CONCURRENCY,
			refreshStagger = REFRESH_STAGGER,
		} = options;

	logDebug('refreshAllExpired started. Options: ', { templateFetchPath, templateElementSelector, startUrl, refreshConcurrency, refreshStagger });

	// Ensure current Inertia version
	const inertiaVersion = await ensureInertiaVersion({ forceRefresh: true });
	logDebug('refreshAllExpired using Inertia version', { inertiaVersion });

	// Refresh offline template from app
	await refreshOfflineTemplate(templateFetchPath, templateElementSelector);

	// Refresh root redirect if configured
	if (startUrl) {
		await refreshRootRedirect(startUrl, inertiaVersion);
		}

		// Get list of cacheable routes
		const list = await getRouteList();
		const toRefresh: RouteMeta[] = [];

		// Identify expired or missing pages
		for (const route of list) {
			const rec = await getPage(route.url);
			if (!rec) {
				// No cached page, add to refresh list
				toRefresh.push(route);
			} else {
				// Check if cached page is expired based on TTL
				const isExpired = (rec.savedAt + (route.ttl || 0) * 1000) < Date.now();
				if (isExpired) {
					toRefresh.push(route);
				}
			}
		}

		// Exit early if nothing to refresh
		if (toRefresh.length === 0) {
			logDebug('No pages to refresh');
			return;
		}

		// Refresh first page to check we're on the right version
		const firstPage = toRefresh.pop();
		if (firstPage) {
			await cachePage(firstPage.url, { inertiaVersion });
		}

		// Exit if only one page was needed
		if (toRefresh.length === 0) {
			return;
		}

		// Refresh remaining pages with concurrency control and staggering
		let index: number = 0;
		const workerCount = Math.min(refreshConcurrency, toRefresh.length);
		const workers: Promise<void>[] = Array.from({ length: workerCount }, async () => {
			// Each worker processes items from the queue
			while (index < toRefresh.length) {
				const currentIndex = index++;
				const route: RouteMeta = toRefresh[currentIndex];

				try {
					await cachePage(route.url, { inertiaVersion });
				} catch (err) {
					logWarn('Failed refreshing route', route.url, err);
				}

				// Stagger requests to avoid overwhelming server
				if (refreshStagger > 0) {
					await new Promise((resolve) => setTimeout(resolve, refreshStagger));
				}
			}
		});

		// Wait for all workers to complete
		await Promise.all(workers);
	} catch (err) {
		logWarn('refreshAllExpired failed', err);
	}
}

/**
 * Caches a single page for offline use.
 * Handles version mismatches by clearing cache and retrying.
 * @param url - The URL to cache
 * @param options - Caching options
 */
export async function cachePage(url: string, options: CachePageOptions = {}): Promise<void> {
	try {
		// Set option defaults
		const { retryOnVersionMismatch = true, inertiaVersion: providedVersion = null } = options;

		// Ensure current Inertia version
		const currentVersion = providedVersion || await ensureInertiaVersion();
		if (!currentVersion) {
			logWarn('Skipping cachePage because no Inertia version is available', { url });
			return;
		}

		// Get existing page to include ETag for conditional request
		const existingPage = await getPage(url);
		const headers: Record<string, string> = {
			'X-Inertia': 'true',
			'X-Inertia-Version': currentVersion,
			'X-Requested-With': 'XMLHttpRequest',
			'Accept': 'application/json',
		};
		if (existingPage?.etag) {
			headers['If-None-Match'] = existingPage.etag;
		}

		// Fetch page data
		const res = await fetch(url, {
			headers,
			credentials: 'include',
		});

		// 304 Not Modified: update timestamp of existing page
		if (res.status === 304) {
			if (existingPage) {
				await touchPage(url);
				return;
			}

			logWarn('Received 304 for uncached page', url);
			return;
		}

		// Handle unsuccessful responses
		if (!res.ok) {
			// 409 Conflict: Inertia version mismatch
			if (res.status === 409) {
				// Don't retry if already retried once (prevent infinite loops)
				if (!retryOnVersionMismatch) {
					logWarn('Version mismatch persisted after one retry; leaving cache empty for route', url);
					return;
				}

				// Clear cache and retry with fresh version
				logWarn('Version mismatch detected for offline page. Clearing stale state and retrying once.', url);
				await clearAllData();
				await getRouteList(true);
				const refreshedVersion = await ensureInertiaVersion({ forceRefresh: true });
				await cachePage(url, { retryOnVersionMismatch: false, inertiaVersion: refreshedVersion });
			} else {
				// Other errors: skip caching this page
				logWarn('Failed to fetch offline page for caching', url, res.statusText);
			}
			return;
		}

		// Cache the page data
		const data = await res.json();
		await storePage(data, { etag: getResponseEtag(res) || undefined });
	} catch (err) {
		logWarn('Failed to cache offline page', url, err);
	}
}

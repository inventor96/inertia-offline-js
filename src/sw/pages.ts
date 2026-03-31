/**
 * Page storage and retrieval for offline Inertia pages.
 * Manages caching of complete pages for offline use.
 */

import { db } from './db.js';
import { logDebug } from './utils.js';
import type { InertiaPage } from './types/db.js';

/**
 * Metadata that may be provided when storing a page.
 */
interface PageMetadata {
	/** ETag from the server response, for cache validation */
	etag?: string | null;
	/** Timestamp when the page was saved (defaults to now) */
	savedAt?: number;
}

/**
 * Inertia page data structure for storage.
 */
interface InertiaPageData {
	/** The URL of the page */
	url: string;
	/** Vue component name */
	component?: string | null;
	/** Component props data */
	props?: Record<string, any> | null;
	/** Inertia version identifier */
	version?: string | null;
}

/**
 * Stores an Inertia page for offline use in the database.
 * Includes page data and metadata like ETag for cache validation.
 * @param data - The page data to store (url, component, props, version)
 * @param metadata - Optional metadata (etag, savedAt timestamp)
 */
export async function storePage(data: InertiaPageData, metadata: PageMetadata = {}): Promise<void> {
	await db.pages.put({
		url: data.url,
		component: data.component ?? null,
		props: data.props ?? null,
		version: data.version ?? null,
		savedAt: metadata.savedAt ?? Date.now(),
		etag: metadata.etag ?? null,
	});
	logDebug('Stored offline page', data.url);
}

/**
 * Updates the saved timestamp of an existing offline page.
 * Used to refresh cache expiration without re-fetching page data.
 * @param url - The URL of the page to update
 * @param savedAt - Timestamp to set (defaults to current time)
 */
export async function touchPage(url: string, savedAt: number = Date.now()): Promise<void> {
	await db.pages.update(url, { savedAt });
	logDebug('Refreshed offline page timestamp', url);
}

/**
 * Retrieves an offline Inertia page from the database.
 * @param url - The URL of the page to retrieve
 * @returns The cached page data, or undefined if not found
 */
export async function getPage(url: string): Promise<InertiaPage | undefined> {
	return await db.pages.get(url);
}

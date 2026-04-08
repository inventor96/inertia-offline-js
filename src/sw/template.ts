/**
 * Offline template management for PWA.
 * Stores and refreshes HTML templates used for offline pages.
 * Fetches templates from the application (derived approach) rather than special backend route.
 */

import { db } from './db.js';
import {
	OFFLINE_TEMPLATE_FETCH_PATH,
	OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
	OFFLINE_TEMPLATE_PAGE_DATA_SOURCE,
	OFFLINE_TEMPLATE_SYSTEM_KEY_PREFIX,
} from './constants.js';
import type { TemplatePageDataSource } from './constants.js';
import { clearDataPageAttribute } from './dom-utils.js';
import { getResponseEtag, logDebug, logWarn } from './utils.js';

/**
 * Generates a system key for storing offline template cached from a specific path.
 * @param fetchPath - The path the template was fetched from
 * @param elementSelector - The CSS selector for the page element
 * @param pageDataSource - The source mode for page data in the template
 * @returns System key for storage in IndexedDB
 */
export function generateOfflineTemplateSystemKey(
	fetchPath: string = OFFLINE_TEMPLATE_FETCH_PATH,
	elementSelector: string = OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
	pageDataSource: TemplatePageDataSource = OFFLINE_TEMPLATE_PAGE_DATA_SOURCE,
): string {
	return `${OFFLINE_TEMPLATE_SYSTEM_KEY_PREFIX}:${fetchPath}:${elementSelector}:${pageDataSource}`;
}

/**
 * Offline template record stored in the system table.
 */
interface OfflineTemplateRecord {
	/** The raw HTML template content */
	html: string;
	/** ETag from server response for cache validation */
	etag: string | null;
	/** Path where the template was fetched from */
	fetchPath: string;
	/** CSS selector for the Inertia page element in the template */
	elementSelector: string;
	/** Payload source mode for page data in the template */
	pageDataSource: TemplatePageDataSource;
	/** Timestamp when template was saved */
	savedAt: number;
}

/**
 * Retrieves the offline template from cache.
 * @param systemKey - System key for the template
 * @returns Template record if cached, otherwise null
 */
export async function getOfflineTemplate(systemKey: string): Promise<OfflineTemplateRecord | null> {
	const rec = await db.system.get(systemKey);
	if (!rec?.value || typeof rec.value !== 'object') {
		logDebug('Offline template cache miss', { systemKey });
		return null;
	}

	logDebug('Offline template cache hit', {
		systemKey,
		savedAt: rec.value.savedAt,
	});
	return rec.value;
}

/**
 * Refreshes the offline template by fetching from the application.
 * Uses a derived approach: fetches the real app HTML and caches it.
 * Uses ETags for efficient cache validation.
 * @param fetchPath - Application path to fetch template from (default: '/')
 * @param elementSelector - CSS selector for the Inertia page element (default: '[data-page]')
 * @param pageDataSource - Source mode for page payload in template (default: 'auto')
 * @returns Updated template record, or null if refresh failed
 */
export async function refreshOfflineTemplate(
	fetchPath: string = OFFLINE_TEMPLATE_FETCH_PATH,
	elementSelector: string = OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
	pageDataSource: TemplatePageDataSource = OFFLINE_TEMPLATE_PAGE_DATA_SOURCE,
): Promise<OfflineTemplateRecord | null> {
	// Generate system key from path and selector
	const systemKey = generateOfflineTemplateSystemKey(fetchPath, elementSelector, pageDataSource);

	try {
		logDebug('Refreshing offline template from app', {
			fetchPath,
			elementSelector,
			pageDataSource,
			systemKey,
		});

		// Get current ETag if available for conditional request
		const existing = await getOfflineTemplate(systemKey);
		const headers: Record<string, string> = {
			// Request HTML, not Inertia JSON (avoid X-Inertia header)
			'Accept': 'text/html',
		};
		if (existing?.etag) {
			headers['If-None-Match'] = existing.etag;
		}

		// Fetch template from application
		// fetch API automatically follows redirects (up to 20 by default)
		const templateRes = await fetch(fetchPath, {
			credentials: 'include',
			headers,
		});

		// 304 Not Modified: reuse existing template, just update timestamp
		if (templateRes.status === 304) {
			if (existing) {
				await db.system.put({
					key: systemKey,
					value: {
						...existing,
						savedAt: Date.now(),
					},
				});
			}

			logDebug('Offline template unchanged (304)', { systemKey });
			return existing;
		}

		// If response not successful, abort refresh
		if (!templateRes.ok) {
			logWarn('Failed to fetch offline template', {
				status: templateRes.status,
				statusText: templateRes.statusText,
				fetchPath,
			});
			return null;
		}

		// Parse template HTML and metadata
		const html = await templateRes.text();
		
		// Clear any pre-existing page data before storing template
		const cleanHtml = clearDataPageAttribute(html, pageDataSource, elementSelector);
		if (!cleanHtml) {
			logWarn('Failed to clear existing page data from template', { fetchPath, pageDataSource, elementSelector });
			return null;
		}
		
		const rec: OfflineTemplateRecord = {
			html: cleanHtml,
			etag: getResponseEtag(templateRes),
			fetchPath,
			elementSelector,
			pageDataSource,
			savedAt: Date.now(),
		};

		// Store updated template
		await db.system.put({ key: systemKey, value: rec });
		logDebug('Offline template stored', {
			systemKey,
			hasEtag: !!rec.etag,
			fetchPath,
			elementSelector,
			pageDataSource,
			savedAt: rec.savedAt,
		});

		return rec;
	} catch (err) {
		logWarn('refreshOfflineTemplate failed', {
			fetchPath,
			elementSelector,
			pageDataSource,
			error: err,
		});
		return null;
	}
}

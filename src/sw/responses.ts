/**
 * Response generation for offline Inertia pages.
 * Constructs responses from cached page data and templates.
 */

import {
	OFFLINE_TEMPLATE_FETCH_PATH,
	OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
	DEFAULT_START_URL,
} from './constants.js';
import { getPage } from './pages.js';
import { getOfflineTemplate, generateOfflineTemplateSystemKey } from './template.js';
import { isCachable } from './routes.js';
import { getRootRedirectResponse } from './redirects.js';
import { injectPageDataToElement, validateSingleDataPageAttribute } from './dom-utils.js';
import { logDebug, logWarn } from './utils.js';
import type { InertiaPage } from './types/db.js';

/**
 * Options for offline navigation response generation.
 */
interface OfflineNavigationResponseOptions {
	/** Path to fetch offline template from (for retrieving cache key) */
	templateFetchPath?: string;
	/** CSS selector for the Inertia page element in template */
	templateElementSelector?: string;
	/** PWA start URL (from manifest.start_url) */
	startUrl?: string;
}

/**
 * Gets a cached page response for the requested path.
 * Constructs a JSON response that mimics a real Inertia page response,
 * including ETag and marking it as offline with saved timestamp.
 * @param path - The request path
 * @returns Response object with cached page data, or null if not cached
 */
export async function getCachedPageResponse(path: string): Promise<Response | null> {
	// Attempt to get the cached page data
	const rec: InertiaPage | undefined = await getPage(path);
	if (!rec) {
		logDebug('Cached page miss', { path });
		return null;
	}

	logDebug('Serving cached Inertia page response', { path, savedAt: rec.savedAt });

	// Build response headers
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Inertia': 'true',
	};
	if (rec.etag) {
		headers['ETag'] = rec.etag;
	}

	// Construct response that mimics a real Inertia page response
	return new Response(JSON.stringify({
		url: rec.url,
		component: rec.component,
		props: {
			...rec.props,
			_offline: true,
			_savedAt: rec.savedAt,
		},
		version: rec.version,
	}), {
		headers,
	});
}

/**
 * Gets an offline navigation response for the requested path.
 * Combines offline template with cached page data to render a full HTML page.
 * Falls back to root redirect if applicable.
 * @param path - The request path
 * @param options - Configuration options
 * @returns Response with offline HTML, or null if unavailable
 */
export async function getOfflineNavigationResponse(
	path: string,
	options: OfflineNavigationResponseOptions = {},
): Promise<Response | null> {
	// Extract options with defaults
	const {
		templateFetchPath = OFFLINE_TEMPLATE_FETCH_PATH,
		templateElementSelector = OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
		startUrl = DEFAULT_START_URL,
	} = options;

	logDebug('Attempting offline navigation response', { 
		path, 
		templateFetchPath,
		templateElementSelector,
	});

	// For start URL, attempt to serve root redirect if available
	if (path === startUrl) {
		const redirectRes = await getRootRedirectResponse(path, false, startUrl);
		if (redirectRes) {
			logDebug('Offline navigation using root redirect response');
			return redirectRes;
		}
	}

	const targetPath = path;

	// Check if the target path is cacheable
	const routeIsCacheable = await isCachable(targetPath);
	if (!routeIsCacheable) {
		logDebug('Offline navigation route is not cacheable', { targetPath });
		return null;
	}

	// Generate system key for retrieving cached template
	const templateSystemKey = generateOfflineTemplateSystemKey(templateFetchPath, templateElementSelector);

	// Get offline template and cached page data in parallel
	const [templateRec, pageRec] = await Promise.all([
		getOfflineTemplate(templateSystemKey),
		getPage(targetPath),
	]);

	// Can't serve offline response without both template and page
	if (!templateRec?.html || !pageRec) {
		logDebug('Offline navigation missing template or cached page', {
			hasTemplate: !!templateRec?.html,
			hasPage: !!pageRec,
			targetPath,
		});
		return null;
	}

	// Validate that template has exactly one matching data-page attribute for safety
	if (!validateSingleDataPageAttribute(templateRec.html)) {
		logWarn('Offline template data-page attribute validation failed', {
			targetPath,
		});
		return null;
	}

	// Assemble page data payload
	const pageData = {
		url: pageRec.url,
		component: pageRec.component,
		props: {
			...pageRec.props,
			_offline: true,
			_savedAt: pageRec.savedAt,
		},
		version: pageRec.version,
	};

	// Inject page data into template via string manipulation
	const html = injectPageDataToElement(templateRec.html, pageData);
	if (!html) {
		logWarn('Failed to inject page data into offline template', {
			targetPath,
		});
		return null;
	}

	logDebug('Returning assembled offline navigation HTML', {
		targetPath,
		savedAt: pageRec.savedAt,
	});

	// Return the assembled HTML as a response
	return new Response(html, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
		},
	});
}

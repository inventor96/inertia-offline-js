/**
 * Root redirect handling for PWA offline support.
 * Manages mappings between root paths and their redirect targets.
 */

import { db } from './db.js';
import { ROOT_REDIRECT_KEY_PREFIX, DEFAULT_START_URL } from './constants.js';
import { ensureInertiaVersion } from './version.js';
import { logDebug, logWarn } from './utils.js';

/**
 * Root redirect record stored in the system table.
 */
interface RootRedirectRecord {
	/** Target path for the redirect */
	target: string;
	/** Timestamp when this redirect was saved */
	savedAt: number;
}

/**
 * Converts a URL-like string to a relative same-origin path.
 * Returns null if the URL is not same-origin or cannot be parsed.
 * @param urlLike - URL string or path to convert
 * @returns Relative path (e.g., '/about'), or null if invalid/different origin
 */
function toRelativeSameOriginPath(urlLike: any): string | null {
	// Empty values can't be converted
	if (!urlLike) {
		return null;
	}

	try {
		// Parse URL and verify same-origin
		const parsed = new URL(urlLike, self.location.origin);
		if (parsed.origin !== self.location.origin) {
			return null;
		}

		return `${parsed.pathname}${parsed.search}`;
	} catch {
		// Not a valid URL, but might be a relative path already
		if (typeof urlLike !== 'string') {
			return null;
		}

		// Return relative paths as-is
		return urlLike.startsWith('/') ? urlLike : null;
	}
}

/**
 * Generates the system database key for a root redirect record.
 * @param path - The source path for the redirect
 * @returns System key for storing/retrieving the redirect
 */
function getRootRedirectSystemKey(path: string = DEFAULT_START_URL): string {
	return `${ROOT_REDIRECT_KEY_PREFIX}${path}`;
}

/**
 * Stores a root redirect mapping in the database.
 * Source and target must be different same-origin paths.
 * @param sourcePath - Source path (usually '/')
 * @param targetPath - Target path for redirect
 */
export async function setRootRedirect(sourcePath: string, targetPath: string): Promise<void> {
	// Ensure paths are same-origin and valid
	const source = toRelativeSameOriginPath(sourcePath);
	const target = toRelativeSameOriginPath(targetPath);

	// Can't store if source/target invalid or if they're the same
	if (!source || !target || source === target) {
		logDebug('Skipping root redirect set', {
			sourcePath,
			targetPath,
			source,
			target,
		});
		return;
	}

	// Store the mapping
	await db.system.put({
		key: getRootRedirectSystemKey(source),
		value: {
			target,
			savedAt: Date.now(),
		} as RootRedirectRecord,
	});
	logDebug('Stored root redirect', { source, target });
}

/**
 * Retrieves a stored root redirect mapping from the database.
 * @param sourcePath - Source path to look up
 * @returns Target path if redirect exists, otherwise null
 */
export async function getRootRedirect(sourcePath: string = DEFAULT_START_URL): Promise<string | null> {
	// Normalize source path
	const source = toRelativeSameOriginPath(sourcePath);

	// Can't retrieve without valid source
	if (!source) {
		logDebug('Root redirect lookup skipped due to invalid source', { sourcePath });
		return null;
	}

	// Look up mapping in system table
	const rec = await db.system.get(getRootRedirectSystemKey(source));
	const target = rec?.value?.target;

	// Normalize and validate target
	const normalizedTarget = toRelativeSameOriginPath(target);
	logDebug('Root redirect lookup result', {
		source,
		target,
		normalizedTarget,
		hit: !!normalizedTarget,
	});

	return normalizedTarget;
}

/**
 * Generates a Response object representing a root redirect.
 * For Inertia requests, returns 409 with X-Inertia-Location header.
 * For navigation, returns 302 HTTP redirect.
 * @param path - Source path
 * @param inertiaRequest - If true, generate Inertia-format response
 * @param sourcePath - The defined source path for redirects
 * @returns Response for the redirect, or null if no redirect needed
 */
export async function getRootRedirectResponse(
	path: string,
	inertiaRequest: boolean = false,
	sourcePath: string = DEFAULT_START_URL,
): Promise<Response | null> {
	logDebug('Resolving root redirect response', { path, inertiaRequest });

	// Root redirects only apply to the defined source path
	if (path !== sourcePath) {
		return null;
	}

	// Look up target path
	const targetPath = await getRootRedirect(sourcePath);
	if (!targetPath || targetPath === sourcePath) {
		logDebug('No root redirect mapping found for response generation');
		return null;
	}

	// For Inertia requests, return 409 with location header
	if (inertiaRequest) {
		logDebug('Returning Inertia root redirect response', { targetPath });
		return new Response('', {
			status: 409,
			headers: {
				'X-Inertia': 'true',
				'X-Inertia-Location': targetPath,
			},
		});
	}

	// For navigation, return standard HTTP 302 redirect
	logDebug('Returning standard root redirect response', { targetPath });
	return Response.redirect(targetPath, 302);
}

/**
 * Extracts the target path from a network response or page data.
 * Checks (in order): X-Inertia-Location header, redirected URL, page data, response JSON
 * @param res - Network response to extract target from
 * @param pageData - Optional page data as fallback
 * @returns Normalized target path, or null if not found
 */
async function extractTargetFromResponse(res: Response, pageData: any = null): Promise<string | null> {
	// First try X-Inertia-Location header
	let target = toRelativeSameOriginPath(res.headers.get('X-Inertia-Location'));

	// If no header, check redirected response URL
	if (!target && res.redirected && res.url) {
		target = toRelativeSameOriginPath(res.url);
	}

	// If still no target, try provided page data
	if (!target) {
		if (pageData?.url) {
			target = toRelativeSameOriginPath(pageData.url);
		} else {
			// Last resort: parse response JSON
			try {
				const data = await res.clone().json();
				target = toRelativeSameOriginPath(data?.url);
			} catch {
				// Ignore non-JSON responses
			}
		}
	}

	return target || null;
}

/**
 * Evaluates a network response to determine if a root redirect mapping should be recorded.
 * Automatically stores redirect if detected.
 * @param path - Request path
 * @param networkRes - Response from network fetch
 * @param pageData - Optional parsed page data
 * @param sourcePath - Defined source path for redirects
 */
export async function maybeRecordRootRedirect(
	path: string,
	networkRes: Response,
	pageData: any = null,
	sourcePath: string = DEFAULT_START_URL,
): Promise<void> {
	// Root redirects only apply to the defined source path
	if (path !== sourcePath) {
		return;
	}

	logDebug('Evaluating potential root redirect mapping from network response', {
		path,
		status: networkRes.status,
		redirected: networkRes.redirected,
		url: networkRes.url,
		hasInertiaLocation: !!networkRes.headers.get('X-Inertia-Location'),
		hasPageDataUrl: !!pageData?.url,
	});

	// Extract target from response or page data
	const targetPath = await extractTargetFromResponse(networkRes, pageData);

	// If we have a valid target different from source, record it
	if (targetPath && targetPath !== sourcePath) {
		await setRootRedirect(sourcePath, targetPath);
		logDebug('Root redirect mapping recorded from network response', {
			source: sourcePath,
			targetPath,
		});
		return;
	}

	logDebug('Network response did not yield a root redirect mapping');
}

/**
 * Proactively refreshes the root redirect mapping by fetching the source path.
 * Updates the stored mapping with the actual redirect target from the server.
 * @param sourcePath - Source path to refresh
 * @param inertiaVersion - Inertia version for request (if not provided, fetches current)
 * @returns Target path if redirect exists, null if none or refresh failed
 */
export async function refreshRootRedirect(sourcePath: string = '/', inertiaVersion: string | null = null): Promise<string | null> {
	// Normalize source path
	const source = toRelativeSameOriginPath(sourcePath);
	if (!source) {
		logDebug('Root redirect refresh skipped due to invalid source', { sourcePath });
		return null;
	}

	try {
		logDebug('Refreshing root redirect mapping', { source });

		// Ensure we have current Inertia version
		const currentVersion = inertiaVersion || await ensureInertiaVersion();
		if (!currentVersion) {
			logWarn('Root redirect refresh skipped because no Inertia version is available', { source });
			return null;
		}

		// Build request headers
		const headers: Record<string, string> = {
			'X-Inertia': 'true',
			'X-Inertia-Version': currentVersion,
			'X-Requested-With': 'XMLHttpRequest',
			'Accept': 'application/json',
		};

		// Fetch source path to detect redirect
		const res = await fetch(source, {
			headers,
			credentials: 'include',
		});

		// Extract target from response
		const target = await extractTargetFromResponse(res);

		// Update mapping if target differs from source
		if (target && target !== source) {
			await setRootRedirect(source, target);
			logDebug('Root redirect refreshed', { source, target });
			return target;
		}

		// Clear mapping if no redirect detected
		await db.system.delete(getRootRedirectSystemKey(source));
		logDebug('Root redirect cleared because source no longer redirects', { source });
		return null;
	} catch (err) {
		logWarn('refreshRootRedirect failed', err);
		return null;
	}
}

/**
 * Inertia version management for offline support.
 * Tracks frontend version changes to invalidate stale cache when needed.
 */

import { db } from './db.js';
import { ROUTE_VERSION_PATH } from './constants.js';
import { clearAllData } from './data.js';
import { logDebug, logWarn } from './utils.js';

/**
 * Options for ensuring the Inertia version is current.
 */
interface EnsureVersionOptions {
	/** Force refresh from server even if local version exists */
	forceRefresh?: boolean;
}

/**
 * Response structure from the version endpoint.
 */
interface VersionResponse {
	version: string;
}

/**
 * Retrieves the locally-cached Inertia version from the database.
 * @returns The cached version string, or null if not yet stored
 */
export async function getLocalInertiaVersion(): Promise<string | null> {
	const rec = await db.system.get('inertiaVersion');
	return rec ? rec.value : null;
}

/**
 * Fetches the current Inertia version from the server.
 * Updates the local cache with the fetched version.
 * @returns The version string from server, or null if fetch fails
 */
export async function getRemoteInertiaVersion(): Promise<string | null> {
	try {
		// Fetch the Inertia version from the server
		const res = await fetch(ROUTE_VERSION_PATH, { credentials: 'include' });
		if (!res.ok) {
			logWarn('Failed to fetch inertia version', res.statusText);
			return null;
		}

		// Parse version and update local cache
		const data: VersionResponse = await res.json();
		await db.system.put({ key: 'inertiaVersion', value: data.version });

		return data.version || null;
	} catch (err) {
		logWarn('getInertiaVersion failed', err);
		return null;
	}
}

/**
 * Ensures the cached Inertia version is current, optionally forcing a refresh.
 * If the version has changed, clears all offline cache to prevent stale data.
 * @param options - Configuration options for version checking
 * @returns The ensured Inertia version, or null if unavailable
 */
export async function ensureInertiaVersion(options: EnsureVersionOptions = {}): Promise<string | null> {
	// Extract options with defaults
	const { forceRefresh = false } = options;

	// Get local version from database
	const localVersion = await getLocalInertiaVersion();

	// If we have a local version and not forcing refresh, return it
	if (!forceRefresh && localVersion) {
		logDebug('Reusing local Inertia version', { localVersion });
		return localVersion;
	}

	logDebug('Refreshing Inertia version before backend cache update requests', {
		forceRefresh,
		localVersion,
	});

	// Fetch the remote version from the server
	const remoteVersion = await getRemoteInertiaVersion();

	if (remoteVersion) {
		// Compare versions and clear cache if changed
		if (remoteVersion !== localVersion) {
			logWarn('Inertia version changed; clearing offline cache before downloading updates', {
				localVersion,
				remoteVersion,
			});
			await clearAllData();
			await db.system.put({ key: 'inertiaVersion', value: remoteVersion });
		}

		logDebug('Updated Inertia version for refresh work', { remoteVersion });
		return remoteVersion;
	}

	logWarn('Failed to refresh Inertia version; falling back to local version if available', {
		localVersion,
	});
	return localVersion;
}

/**
 * Dexie database initialization and configuration for offline Inertia pages.
 * Stores cached pages, route metadata, and system information.
 */

import { Dexie } from 'dexie';
import type { OfflineDatabase } from './types/db.js';

/**
 * Initialize the offline database with typed reactive access to stores.
 * The database uses Dexie's IndexedDB wrapper for reliable offline storage.
 */
export const db: OfflineDatabase = new Dexie('InertiaOfflineDB') as OfflineDatabase;

db.version(4).stores({
	// Cache individual Inertia pages by their URL
	pages: '&url, component, props, version, savedAt, etag',

	// Metadata about which routes are cacheable offline
	routeMeta: '&url, ttl',

	// System-level metadata (e.g., Inertia version, sync state)
	system: '&key, value',
});

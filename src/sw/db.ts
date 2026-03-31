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

db.version(3).stores({
	// Cache individual Inertia pages by their URL
	// Indexed fields allow quick filtering: pages are indexed by component, props, version, savedAt, and etag
	pages: '&url, component, props, version, savedAt, etag',

	// Metadata about which routes are cacheable offline
	// Indexed by URL for quick lookup, plus paginated and ttl for filtering/sorting
	routeMeta: '&url, paginated, ttl',

	// System-level metadata (e.g., Inertia version, sync state)
	// Key-value store with key as primary index
	system: '&key, value',
});

/**
 * Data management functions for the offline/inertia module.
 * Handles clearing and managing cached offline data.
 */

import { db } from './db.js';
import { logDebug } from './utils.js';

/**
 * Clears all offline data from the database.
 * Removes route metadata, cached pages, and system records.
 * This is typically called when detecting an Inertia version change
 * to ensure stale data doesn't cause issues with the updated frontend.
 * @returns Promise that resolves when all data has been cleared
 */
export async function clearAllData(): Promise<void> {
	await Promise.all([
		db.routeMeta.clear(),
		db.pages.clear(),
		db.system.clear(),
	]);
	logDebug('Cleared all offline data');
}

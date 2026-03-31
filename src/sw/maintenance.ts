/// <reference lib="webworker" />

/**
 * Offline maintenance handlers for service worker events.
 * Manages periodic updates, push notifications, and message-based offline operations.
 */

import { clearAllData } from './data.js';
import { getRefreshOptions, refreshAllExpired } from './refresh.js';
import { getRouteList } from './routes.js';
import { logDebug, logWarn } from './utils.js';
import type { RefreshOptions } from './refresh.js';
import { DEFAULT_PERIODIC_SYNC_TAGS, DEFAULT_PUSH_REFRESH_TYPE } from './constants.js';

/**
 * PeriodicSyncEvent type for background sync API.
 * Provides type definitions for the Periodic Background Sync API.
 */
interface PeriodicSyncEvent extends ExtendableEvent {
	/** The tag associated with this periodic sync event */
	tag: string;
}

/**
 * Configuration options for offline maintenance handlers.
 */
interface MaintenanceHandlerOptions extends RefreshOptions {
	/** Tags for periodic sync events */
	periodicSyncTags?: Set<string> | string[];
	/** Push notification type for refresh events */
	pushRefreshType?: string;
}

/**
 * Maintenance handler functions for service worker event handling.
 */
interface OfflineMaintenanceHandlers {
	/** Warms up the route cacheability index */
	warmRouteCacheabilityIndex: () => Promise<boolean>;
	/** Refreshes all expired offline data */
	refreshExpired: () => Promise<void>;
	/** Clears all offline data */
	clearOfflineData: () => Promise<void>;
	/** Handles message events from the frontend */
	handleMessageEvent: (event: ExtendableMessageEvent) => boolean;
	/** Handles periodic sync events from the browser */
	handlePeriodicSyncEvent: (event: PeriodicSyncEvent) => boolean;
	/** Handles push events from the browser */
	handlePushEvent: (event: PushEvent) => boolean;
	/** The resolved refresh options used by these handlers */
	refreshOptions: RefreshOptions;
}

/**
 * Merges user options with defaults for refresh configuration.
 * @param userOptions - User-provided options
 * @returns Merged options with defaults applied
 */
function resolveRefreshOptions(userOptions: MaintenanceHandlerOptions = {}): RefreshOptions {
	const defaults = getRefreshOptions();

	const refreshOptions: RefreshOptions = {
		...defaults,
		...userOptions,
	};
	logDebug('Resolved refresh options', refreshOptions);
	return refreshOptions;
}

/**
 * Parses push event data as JSON.
 * @param event - The push event
 * @returns Parsed push data, or empty object if parse fails
 */
function parsePushData(event: PushEvent | undefined): Record<string, any> {
	if (!event?.data || typeof event.data.json !== 'function') {
		return {};
	}

	try {
		return event.data.json() || {};
	} catch (err) {
		logWarn('Failed to parse push payload JSON', err);
		return {};
	}
}

/**
 * Creates offline maintenance handlers for service worker event management.
 * These handlers manage periodic syncs, push notifications, and frontend messages
 * to keep offline data fresh and synchronized.
 * @param userOptions - Configuration options
 * @returns Object with maintenance handler functions
 */
export function createOfflineMaintenanceHandlers(
	userOptions: MaintenanceHandlerOptions = {},
): OfflineMaintenanceHandlers {
	const refreshOptions = resolveRefreshOptions(userOptions);
	const periodicSyncTags = new Set(userOptions.periodicSyncTags || DEFAULT_PERIODIC_SYNC_TAGS);
	const pushRefreshType = userOptions.pushRefreshType || DEFAULT_PUSH_REFRESH_TYPE;

	let routeCacheWarmupPromise: Promise<boolean> | null = null;

	/**
	 * Warms up the route cacheability index by fetching routes and populating
	 * the in-memory index for fast synchronous lookups.
	 * @returns True if warming succeeded, false if it failed
	 */
	const warmRouteCacheabilityIndex = (): Promise<boolean> => {
		if (!routeCacheWarmupPromise) {
			routeCacheWarmupPromise = getRouteList()
				.then(() => {
					logDebug('Route cacheability index warmed by maintenance handlers');
					return true;
				})
				.catch((err) => {
					logWarn('Failed to warm route cacheability index from maintenance handlers', err);
					return false;
				});
		}

		return routeCacheWarmupPromise;
	};

	/**
	 * Refreshes all expired offline pages and templates.
	 */
	const refreshExpired = async (): Promise<void> => refreshAllExpired(refreshOptions);

	/**
	 * Clears all offline cache data.
	 */
	const clearOfflineData = async (): Promise<void> => clearAllData();

	/**
	 * Handles message events from the frontend application.
	 * Supports CLEAR_OFFLINE and REFRESH_EXPIRED commands.
	 * @param event - The message event
	 * @returns True if handled, false otherwise
	 */
	const handleMessageEvent = (event: ExtendableMessageEvent): boolean => {
		const { type } = event?.data || {};
		logDebug('Maintenance handler received message event', { type });

		switch (type) {
			case 'CLEAR_OFFLINE':
				event.waitUntil(clearOfflineData());
				return true;
			case 'REFRESH_EXPIRED':
				event.waitUntil(refreshExpired());
				return true;
			default:
				return false;
		}
	};

	/**
	 * Handles periodic sync events from the browser.
	 * Refreshes offline cache if the sync tag matches configured tags.
	 * @param event - The periodic sync event
	 * @returns True if handled, false otherwise
	 */
	const handlePeriodicSyncEvent = (event: PeriodicSyncEvent): boolean => {
		logDebug('Maintenance handler received periodic sync event', { tag: event.tag });

		// Only handle events with configured refresh tags
		if (!periodicSyncTags.has(event.tag)) {
			return false;
		}

		event.waitUntil(refreshExpired());
		return true;
	};

	/**
	 * Handles push events from the browser.
	 * Refreshes offline cache if push payload has configured refresh type.
	 * @param event - The push event
	 * @returns True if handled, false otherwise
	 */
	const handlePushEvent = (event: PushEvent): boolean => {
		const data = parsePushData(event);
		logDebug('Maintenance handler received push event', { data });

		// Only handle push events with configured refresh type
		if (data?.type !== pushRefreshType) {
			return false;
		}

		event.waitUntil(refreshExpired());
		return true;
	};

	return {
		clearOfflineData,
		handleMessageEvent,
		handlePeriodicSyncEvent,
		handlePushEvent,
		refreshExpired,
		refreshOptions,
		warmRouteCacheabilityIndex,
	};
}

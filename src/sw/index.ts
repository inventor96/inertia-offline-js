/**
 * Central export point for offline/inertia module.
 * Re-exports all public APIs from sub-modules.
 */

// Constants
export {
	DEFAULT_START_URL,
	OFFLINE_TEMPLATE_FETCH_PATH,
	OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
} from './constants.js';

// Refresh and caching
export { getRefreshOptions, refreshAllExpired, cachePage } from './refresh.js';

// Route cacheability
export { isCachable, isCachableSync, getRouteList } from './routes.js';

// Page management
export { storePage, touchPage, getPage } from './pages.js';

// Version management
export { getLocalInertiaVersion, getRemoteInertiaVersion } from './version.js';

// Template management
export { getOfflineTemplate, refreshOfflineTemplate, generateOfflineTemplateSystemKey } from './template.js';

// Root redirect handling
export {
	setRootRedirect,
	getRootRedirect,
	getRootRedirectResponse,
	maybeRecordRootRedirect,
} from './redirects.js';

// Response generation
export { getCachedPageResponse, getOfflineNavigationResponse } from './responses.js';

// DOM utilities for offline template handling
export {
	injectPageDataToElement,
	clearDataPageAttribute,
} from './dom-utils.js';

// Data management
export { clearAllData } from './data.js';

// Fetch handler
export { createOfflineFetchHandler } from './fetch.js';

// Maintenance handlers
export { createOfflineMaintenanceHandlers } from './maintenance.js';

// Logging utilities
export { setDebugLogging } from './utils.js';

// Re-export types
export type {
	InertiaPage,
	RouteMeta,
	SystemKey,
	OfflineDatabase,
	CachedResponse,
	OfflineNavigationResponse,
	RequestType,
	CacheabilityCheck,
	RequestContext,
	RouteCheckFunction,
	RouteSyncCheckFunction,
	LogLevel,
	LogOptions,
	Result,
	OfflineHtmlBuilder,
} from './types/index.js';

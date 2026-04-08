/**
 * Constants for the offline/inertia module.
 * Centralized configuration values for PWA offline caching.
 */

/** Endpoint path for fetching offline-cacheable routes */
export const ROUTE_META_PATH: string = '/pwa/offline-routes';

/** Endpoint path for fetching the current Inertia version */
export const ROUTE_VERSION_PATH: string = '/pwa/offline-version';

/** Key prefix for storing root URL redirect information */
export const ROOT_REDIRECT_KEY_PREFIX: string = 'rootRedirect:';

/** The default start URL for the PWA (from manifest.start_url) */
export const DEFAULT_START_URL: string = '/';

/** Path to fetch the offline template from (default: /) */
export const OFFLINE_TEMPLATE_FETCH_PATH: string = '/';

/** CSS selector for the Inertia page data element (default: [data-page]) */
export const OFFLINE_TEMPLATE_ELEMENT_SELECTOR: string = '[data-page]';

/** Source mode for locating Inertia page payload in HTML templates */
export type TemplatePageDataSource = 'auto' | 'script' | 'attribute';

/** Default page payload source mode (v3 script first, then v2 attribute fallback) */
export const OFFLINE_TEMPLATE_PAGE_DATA_SOURCE: TemplatePageDataSource = 'auto';

/** Prefix for system keys storing offline templates, followed by fetch path and selector */
export const OFFLINE_TEMPLATE_SYSTEM_KEY_PREFIX: string = 'offlineTemplate:v2';

/** Maximum number of concurrent page refresh operations */
export const REFRESH_CONCURRENCY: number = 4;

/** Delay in milliseconds between staggered refresh operations */
export const REFRESH_STAGGER: number = 500;

/** HTTP status codes that trigger offline fallback behavior */
export const DEFAULT_OFFLINE_FALLBACK_STATUSES = new Set([502, 503, 504]);

/** Tags for periodic sync events that trigger offline refresh */
export const DEFAULT_PERIODIC_SYNC_TAGS = new Set(['inertia-refresh', 'inertia-refresh:default']);

/** Push notification type that triggers offline refresh */
export const DEFAULT_PUSH_REFRESH_TYPE = 'refresh-offline';

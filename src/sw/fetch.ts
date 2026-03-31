/// <reference lib="webworker" />

/**
 * Offline fetch handler for the service worker.
 * Implements caching strategies for Inertia requests, navigation, and XHR-like requests.
 */

import { getCachedPageResponse, getOfflineNavigationResponse } from './responses.js';
import { getRootRedirectResponse, maybeRecordRootRedirect } from './redirects.js';
import { isCachableSync } from './routes.js';
import { storePage } from './pages.js';
import { DEFAULT_START_URL } from './constants.js';
import { logDebug, logWarn } from './utils.js';
import type { OfflineHtmlBuilder } from './types/utils.js';
import { DEFAULT_OFFLINE_FALLBACK_STATUSES } from './constants.js';

/**
 * Custom fetch handler function type.
 */
type CustomFetchHandler = (context: FetchContext & { waitUntil: (promise: Promise<unknown>) => void }) => Promise<Response | null | undefined> | Response | null | undefined;

/**
 * Fetch event handler function that returns true/false indicating if the handler
 * intercepted the request.
 */
type FetchEventHandler = (event: FetchEvent) => boolean;

/**
 * Classified request context containing parsed request information
 * and eligibility flags for various handling paths.
 */
interface FetchContext {
	/** Original FetchEvent from the service worker */
	event: FetchEvent;
	/** The fetch Request object */
	request: Request;
	/** Parsed URL object */
	requestUrl: URL;
	/** Request path (URL without origin) */
	path: string;
	/** True if request is from same origin */
	sameOrigin: boolean;
	/** True if request is a GET */
	isGet: boolean;
	/** True if this path is cacheable */
	cacheable: boolean | null;
	/** True if marked as Inertia request (X-Inertia: true header) */
	inertia: boolean;
	/** True if request is a navigation (mode: navigate or Accept: text/html) */
	navigation: boolean;
	/** True if request is XHR-like (XMLHttpRequest or Accept: application/json) */
	xhrLike: boolean;
	/** True if this is a built-in eligible Inertia request */
	builtInInertia: boolean;
	/** True if this is a built-in eligible navigation request */
	builtInNavigation: boolean;
	/** True if this is a built-in eligible XHR request */
	builtInXhrLike: boolean;
	/** True if any built-in handlers apply */
	builtInEligible: boolean;
}

/**
 * Configuration options for the offline fetch handler.
 */
interface FetchHandlerOptions {
	/** HTTP status codes that should trigger offline fallback (default: 502, 503, 504) */
	offlineFallbackStatuses?: Set<number>;
	/** Function to generate offline HTML (default: defaultBuildOfflineHtml) */
	buildOfflineHtml?: OfflineHtmlBuilder;
	/** Custom fetch handlers to run before default handlers */
	customHandlers?: Array<CustomFetchHandler>;
	/** PWA start URL (from manifest.start_url, default: '/') */
	startUrl?: string;
}

/**
 * Builds an app-agnostic offline HTML page for display when a page cannot be served from cache.
 * @param context - The classified request context
 * @returns HTML string for offline error page
 */
function defaultBuildOfflineHtml(context: Record<string, any>): string {
	const path = context?.path || '/';
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Offline</title>
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body {
		font-family: system-ui, -apple-system, sans-serif;
		background: #f8f9fa;
		color: #212529;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 2rem;
	}
	.card {
		background: #fff;
		border: 1px solid #dee2e6;
		border-radius: 0.5rem;
		max-width: 480px;
		width: 100%;
		padding: 2rem;
		text-align: center;
		box-shadow: 0 2px 8px rgba(0,0,0,0.08);
	}
	.icon { font-size: 3rem; margin-bottom: 1rem; }
	h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.75rem; }
	p { color: #6c757d; line-height: 1.5; margin-bottom: 0.5rem; }
	.path { font-family: monospace; font-size: 0.85rem; color: #adb5bd; }
</style>
</head>
<body>
<div class="card">
	<div class="icon">&#9889;</div>
	<h1>You\'re Offline</h1>
	<p>This page is not available offline. Please check your connection and try again.</p>
	<p class="path">${path}</p>
</div>
</body>
</html>`;
}

/**
 * Classifies an incoming fetch event and extracts relevant information.
 * Returns a context object with request details and eligibility flags.
 * @param event - The FetchEvent from the service worker
 * @returns Classified request context
 */
function classifyRequest(event: FetchEvent): FetchContext {
	const request = event.request;
	const requestUrl = new URL(request.url);
	const path = requestUrl.href.replace(requestUrl.origin, '');
	const sameOrigin = requestUrl.origin === self.location.origin;
	const isGet = request.method === 'GET';
	const accept = request.headers.get('Accept') || '';
	const xrw = (request.headers.get('X-Requested-With') || '').toLowerCase();

	const inertia = request.headers.get('X-Inertia') === 'true';
	const navigation = !inertia && (request.mode === 'navigate' || accept.includes('text/html'));
	const xhrLike = !inertia && !navigation && (
		xrw === 'xmlhttprequest'
		|| (accept.includes('application/json') && !accept.includes('text/html'))
	);
	const cacheable = !inertia || isCachableSync(path);
	const builtInInertia = sameOrigin && isGet && inertia;
	const builtInNavigation = sameOrigin && isGet && navigation;
	const builtInXhrLike = sameOrigin && isGet && xhrLike;
	const builtInEligible = builtInInertia || builtInNavigation || builtInXhrLike;

	const classification: FetchContext = {
		event,
		request,
		requestUrl,
		path,
		sameOrigin,
		isGet,
		cacheable,
		inertia,
		navigation,
		xhrLike,
		builtInInertia,
		builtInNavigation,
		builtInXhrLike,
		builtInEligible,
	};

	logDebug('Request classified', classification);

	return classification;
}

/**
 * Builds a Response object for offline HTML errors.
 * @param context - Request context
 * @param buildOfflineHtml - Function to generate HTML content
 * @returns Response with 503 status and offline HTML
 */
function buildOfflineHtmlResponse(context: FetchContext, buildOfflineHtml: OfflineHtmlBuilder): Response {
	return new Response(buildOfflineHtml(context), {
		status: 503,
		statusText: 'Service Unavailable',
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	});
}

/**
 * Handles offline responses by attempting to serve cached pages or root redirects.
 * Falls back to generic offline HTML if no cache found.
 * @param context - Request context
 * @param options - Fetch handler options
 * @returns Response appropriate for offline scenario
 */
async function handleOfflineResponse(context: FetchContext, options: FetchHandlerOptions): Promise<Response> {
	const { path } = context;
	const { buildOfflineHtml = defaultBuildOfflineHtml, startUrl = DEFAULT_START_URL } = options;

	// For start URL, check for cached root redirect before generic offline page
	if (path === startUrl) {
		logDebug('Handling offline response for start URL, checking for root redirect');
		try {
			const redirectRes = await getRootRedirectResponse(path, true, startUrl);
			if (redirectRes) {
				logDebug('Serving root redirect response for offline request', { target: redirectRes.headers.get('X-Inertia-Location') });
				return redirectRes;
			}
			logDebug('No root redirect response found for offline request, falling back to generic offline page');
		} catch (err) {
			logWarn('Failed to get root redirect response', err);
		}
	}

	// Try to get a cached page response
	try {
		const cachedRes = await getCachedPageResponse(path);
		if (cachedRes) {
			logDebug('Serving cached page response for offline request', { path });
			return cachedRes;
		}
		logDebug('No cached page response found for offline request', { path });
	} catch (err) {
		logWarn('Failed to get cached page response', err);
	}

	// No cached page, serve generic offline HTML response
	logDebug('Serving generic offline HTML response', { path });
	return buildOfflineHtmlResponse(context, buildOfflineHtml);
}

/**
 * Main fetch handler for Inertia requests.
 * Implements: try network → cache if successful → offline fallback.
 * @param context - Request context with event and request
 * @param options - Fetch handler options
 * @returns Response from network, cache, or offline fallback
 */
async function handleInertiaFetch(context: FetchContext, options: FetchHandlerOptions): Promise<Response> {
	const { event, request, path } = context;
	const offlineFallbackStatuses = options.offlineFallbackStatuses || DEFAULT_OFFLINE_FALLBACK_STATUSES;
	const startUrl = options.startUrl || DEFAULT_START_URL;
	logDebug('Handling Inertia fetch', { path });

	try {
		// Make the network request
		const networkRes = await fetch(request);

		// Record root redirect if applicable
		event.waitUntil(maybeRecordRootRedirect(path, networkRes, null, startUrl));

		// Handle HTTP errors that should trigger offline fallback
		if (offlineFallbackStatuses.has(networkRes.status)) {
			logDebug('Network response has offline fallback status, handling offline response', { status: networkRes.status, path });
			return await handleOfflineResponse(context, options);
		}

		// If successful response and cacheable, update cache in background
		if (networkRes.status === 200 && context.cacheable) {
			logDebug('Network response successful, updating cache in the background', { path });

			event.waitUntil((async () => {
				try {
					const data = await networkRes.clone().json();
					await storePage(data, { etag: networkRes.headers.get('ETag') || undefined });
				} catch (err) {
					logWarn('Failed to store page data', err);
				}
			})());
		}

		return networkRes;
	} catch (err) {
		// Network request failed, likely offline
		logWarn('[Service Worker] Network request failed:', path, err);
		return await handleOfflineResponse(context, options);
	}
}

/**
 * Runs custom fetch handlers in sequence until one returns a Response.
 * @param context - Request context
 * @param options - Fetch handler options with customHandlers array
 * @returns Response from first handler, or null if none handled
 */
async function runCustomHandlers(context: FetchContext, options: FetchHandlerOptions): Promise<Response | null> {
	const { customHandlers } = options;
	if (!Array.isArray(customHandlers) || customHandlers.length === 0) {
		logDebug('No custom fetch handlers configured');
		return null;
	}

	// Run handlers in sequence, returning first Response
	for (const handler of customHandlers) {
		// Skip invalid handlers
		if (typeof handler !== 'function') {
			logDebug('Skipping invalid custom fetch handler', { handler });
			continue;
		}

		try {
			logDebug('Running custom fetch handler', { handler });
			const response = await handler({
				...context,
				waitUntil: (promise: Promise<unknown>) => context.event.waitUntil(promise),
			});
			if (response instanceof Response) {
				return response;
			}
		} catch (err) {
			logWarn('[Service Worker] Custom fetch handler failed', err);
		}
	}

	// No handler returned a Response
	logDebug('No custom fetch handler returned a response');
	return null;
}

/**
 * Handles navigation fetch requests.
 * Attempts to serve cached offline page or fallback to generic offline response.
 * @param context - Request context
 * @param options - Fetch handler options
 * @returns Navigation response
 */
async function handleNavigationFetch(context: FetchContext, options: FetchHandlerOptions): Promise<Response> {
	const { request, path } = context;
	const offlineFallbackStatuses = options.offlineFallbackStatuses || DEFAULT_OFFLINE_FALLBACK_STATUSES;
	const buildOfflineHtml = options.buildOfflineHtml || defaultBuildOfflineHtml;
	const startUrl = options.startUrl || DEFAULT_START_URL;
	logDebug('Handling navigation fetch', { path });

	try {
		// Make the network request
		const networkRes = await fetch(request);

		// Handle HTTP errors that should trigger offline fallback
		if (offlineFallbackStatuses.has(networkRes.status)) {
			logDebug('Network response has offline fallback status, handling offline response', { status: networkRes.status, path });
			const offlineHtmlRes = await getOfflineNavigationResponse(path, { startUrl });
			if (offlineHtmlRes) {
				return offlineHtmlRes;
			}
			logDebug('No cached offline navigation response found, passing through network response', { path });
		}

		// Pass through the network response
		return networkRes;
	} catch (err) {
		// Network request failed, likely offline
		logWarn('[Service Worker] Network request failed:', path, err);

		// Try to serve cached offline navigation response
		logDebug('Attempting to serve cached offline navigation response', { path });
		const offlineHtmlRes = await getOfflineNavigationResponse(path, { startUrl });
		if (offlineHtmlRes) {
			return offlineHtmlRes;
		}

		// No cached offline response, serve generic offline HTML
		logDebug('No cached offline navigation response found, serving generic offline HTML response', { path });
		return buildOfflineHtmlResponse(context, buildOfflineHtml);
	}
}

/**
 * Handles XHR-like fetch requests (XMLHttpRequest, fetch with JSON accept).
 * Returns 503 Service Unavailable on network failure.
 * @param context - Request context
 * @param options - Fetch handler options (unused, for consistency)
 * @returns Response from network or 503 error
 */
async function handleXhrLikeFetch(context: FetchContext, _options: FetchHandlerOptions): Promise<Response> {
	const { request, path } = context;
	logDebug('Handling XHR-like fetch', { path });

	try {
		// Try the network request
		return await fetch(request);
	} catch (err) {
		// Network request failed, likely offline
		logWarn('[Service Worker] Network request failed:', path, err);
		return new Response('', {
			status: 503,
			statusText: 'Service Unavailable',
			headers: { 'Content-Type': 'text/plain' },
		});
	}
}

/**
 * Creates a fetch event handler with custom extension points.
 * The handler implements offline support for Inertia requests with fallback to
 * generic offline responses. Custom handlers can be provided for app-specific logic.
 * @param userOptions - Configuration options for the handler
 * @returns Fetch event handler function
 */
export function createOfflineFetchHandler(userOptions: FetchHandlerOptions = {}): FetchEventHandler {
	// Set up options with defaults
	const options: FetchHandlerOptions = {
		offlineFallbackStatuses: userOptions.offlineFallbackStatuses || DEFAULT_OFFLINE_FALLBACK_STATUSES,
		buildOfflineHtml: userOptions.buildOfflineHtml || defaultBuildOfflineHtml,
		customHandlers: userOptions.customHandlers || [],
		startUrl: userOptions.startUrl || DEFAULT_START_URL,
	};
	logDebug('Offline fetch handler created with options', { ...options, customHandlers: options.customHandlers?.length });

	return function handleOfflineFetchEvent(event: FetchEvent): boolean {
		logDebug('Fetch event received', { method: event.request.method, url: event.request.url });

		// Classify the request
		const context = classifyRequest(event);
		const hasCustomHandlers = Array.isArray(options.customHandlers) && options.customHandlers.length > 0;

		// Don't intercept if not eligible and no custom handlers
		if (!context.builtInEligible && !hasCustomHandlers) {
			logDebug('Request not eligible for built-in handling and no custom handlers configured, skipping', { path: context.path });
			return false;
		}

		event.respondWith((async () => {
			// Handle Inertia requests
			if (context.builtInInertia) {
				return handleInertiaFetch(context, options);
			}

			// Run custom handlers
			const customResponse = await runCustomHandlers(context, options);
			if (customResponse) {
				return customResponse;
			}

			// Handle navigation requests
			if (context.builtInNavigation) {
				return handleNavigationFetch(context, options);
			}

			// Handle non-Inertia XHR-like requests
			if (context.builtInXhrLike) {
				return handleXhrLikeFetch(context, options);
			}

			// Fallback to normal network request
			logDebug('No handlers returned a response, falling back to network', { path: context.path });
			return fetch(context.request);
		})());

		return true;
	};
}

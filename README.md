# inertia-offline

> Beta: offline read-only layer for Inertia.js apps, focused on safe cached content and navigation fallback.

## Intro

`inertia-offline` is a service worker utility package for Inertia.js apps that enables read-only offline behavior with a Vue composable for state, connectivity, and periodic refresh orchestration.

This JS/TS frontend package is designed to work with a backend package, e.g. [`inertia-offline`](https://github.com/inventor96/inertia-offline-php) (the core PHP backend package). Both the frontend and the backend aspects are required for an Inertia.js app.

### Goals:
  - proactive and reactive offline read-only Inertia route caching
  - offline navigation fallback
  - Inertia version validation and stale cache eviction
  - route list cacheability metadata handling
  - support for ETag-based conditional requests and 304 handling
  - periodic refresh by `PeriodicSync`, fallback timers, push and explicit command
  - reflecting server-side functionality at the start_url (e.g. start_url = `/`, but server redirects `/` to `/dashboard`)

### Why Read-only?

Writing while offline (forms, mutations) is app-specific and requires custom conflict/resume logic, backend policies, and UX choices.

`inertia-offline` intentionally supports read-only caching and navigation behaviors.

If you need writes, implement them in your own service worker (see SW setup). This package exposes `createOfflineFetchHandler(options)` for request path handling. You can add custom handlers in your SW before/after the built-in path.

### ⚠️ Storage Efficiency

Because we're caching the Inertia page responses, there's a good chance that the browser's offline storage will become bloated, especially if your app has a lot of shared props. This is magnified with paginated (or other iterable) routes. This is because there's no database normalization or deduplication, like you should have in your backend. If storage is a concern, consider implementing your own service worker that can implement a more sophisticated caching strategy.

---

## Setup Service Worker

You must add a service worker script and wire event listeners.

### 1. Install

```bash
npm install inertia-offline
```

### 2. Service Worker module imports

```js
import {
  createOfflineFetchHandler,
  createOfflineMaintenanceHandlers,
  //setDebugLogging, // enable for verbose logging during development and troubleshooting
} from 'inertia-offline/sw';
```

### 3. Configure

```js
const fetchHandler = createOfflineFetchHandler({
  /**
   * must match your app's start_url in the manifest
   */
  startUrl: '/',

  /**
   * if the server responds with one of these, treat as offline and serve from
   * cache if available
   */
  offlineFallbackStatuses: new Set([502, 503, 504]),

  /**
   * custom offline HTML builder for non-Inertia routes (e.g. static pages, or
   * a custom offline page)
   */
  buildOfflineHtml: (event) => `...`,

  /**
   * array of custom fetch handlers. each handler receives the original
   * FetchEvent and can return a Response to take over the request. handlers
   * are run after built-in Inertia handling, but before built-in navigation
   * and non-Inertia XHR handling.
   */
  customHandlers: [async (event) => { ... }],
});

const {
  warmRouteCacheabilityIndex,
  handleMessageEvent,
  handlePeriodicSyncEvent,
  handlePushEvent
} = createOfflineMaintenanceHandlers({
  /**
   * tags to identify periodic sync events for inertia offline refresh; must
   * match tags used by frontend app (e.g. `usePwa`)
   */
  periodicSyncTags: new Set(['inertia-refresh', 'inertia-refresh:default']),

  /**
   * push event data type to identify refresh event
   */
  pushRefreshType: 'refresh-offline',

  /**
   * path from which to fetch the Inertia template HTML; the page data will be
   * removed from the template (if any) before being stored in the cache, and
   * used to boot the app when offline
   */
  templateFetchPath: '/',

  /**
   * selector to identify the element in the template HTML that has the Inertia
   * page data
   */
  templateElementSelector: '[data-page]',

  /**
   * endpoint that returns offline route metadata
   */
  routeMetaPath: '/pwa/offline-routes',

  /**
   * endpoint that returns the current Inertia version
   */
  routeVersionPath: '/pwa/offline-version',

  /**
   * must match your app's start_url in the manifest
   */
  startUrl: '/',

  /**
   * how many concurrent requests to allow when refreshing expired cache
   * entries
   */
  refreshConcurrency: 4,

  /**
   * delay in ms between refreshes when multiple entries are expired at the
   * same time
   */
  refreshStagger: 500,
});
```

### 4. Event listeners

```js
self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		await warmRouteCacheabilityIndex()
		await self.clients.claim() // not part of this package, but recommended SW best practice
	})())
});

self.addEventListener('fetch', (event) => {
  if (fetchHandler(event)) return;
});

self.addEventListener('message', (event) => {
  if (handleMessageEvent(event)) return;
});

self.addEventListener('periodicsync', (event) => {
  if (handlePeriodicSyncEvent(event)) return;
});

self.addEventListener('push', (event) => {
  if (handlePushEvent(event)) return;
});
```

### 5. Custom fetch handlers

Custom handlers receive the original `FetchEvent`, so they can inspect `event.request`, call `event.waitUntil(...)`, or return a `Response` exactly like a normal service worker fetch handler.

They run in array order. The first handler that returns a `Response` wins. Returning anything else (e.g. `null` or `undefined`) means "not handled", so the next custom handler or the package's built-in logic continues.

Some examples of things you can do in a custom handler:
```js
function demoCustomHandler(event) {
	const { request } = event;
	const url = new URL(request.url);

	// skip requests this handler does not care about
	if (request.method !== 'GET') return null;

	// schedule background work with the native fetch event API
	if (url.pathname === '/api/track') {
		event.waitUntil(Promise.resolve());
		return null;
	}

	// return a Response directly and stop the handler chain
	if (url.pathname === '/ping') {
		return new Response('pong', {
			status: 200,
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	// do async work and resolve to a Response
	if (url.pathname === '/api/preferences') {
		return caches.match(request).then((cached) => cached || null);
	}

	// catch errors locally and return a fallback Response
	if (url.pathname === '/api/profile') {
		return fetch(request).catch(() => new Response(JSON.stringify({ offline: true }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		}));
	}

	// return undefined or null to let the next handler or built-in logic continue
	return null;
}

const fetchHandler = createOfflineFetchHandler({
	customHandlers: [demoCustomHandler],
});
```

Notes:
- built-in Inertia GET handling runs before `customHandlers`
- `customHandlers` run before built-in navigation and non-Inertia XHR handling
- thrown errors or rejected promises from a custom handler are caught and logged, then the next handler continues
- if you need to intercept any Inertia GET requests, do that in the service worker's `fetch` listener before calling `fetchHandler(event)`
- anything that prevents the built-in Inertia GET handling from running (e.g. responding to the request before calling `fetchHandler(event)`) will also prevent the reactive offline caching functionality for that request, since that is tied to the built-in handling

---

## App Setup

### Recommended: Vite + `vite-plugin-pwa`

`usePwa()` is built around the `registerSW` function from `virtual:pwa-register`; using Vite PWA gives smooth building, registration, and update handling. Because it's a virtual module that depends your Vite configuration, you must import it yourself and pass the `registerSW` function to `usePwa` for it to work correctly.

If you want to handle your own service worker registration and messaging, this dependency is not required.

### Vue composable

```ts
import { registerSW } from 'virtual:pwa-register';
import { usePwa } from 'inertia-offline/vue';

const {
  createPwa,
  postServiceWorkerMessage,
  onlineAndConnected,
  showRefresh,
  installEvent,
  updateSW,
} = usePwa({
	/**
	 * pass the registerSW function from vite-plugin-pwa
	 */
	registerSW,

  /**
   * how often update checks and refreshes should occur; set to `null` to
   * disable periodic refresh
   */
  refreshIntervalMs: 900000, // 15 minutes

  /**
   * initial delay before first update check and refresh after app boot; set to
   * `null` to disable initial refresh
   */
  initialRefreshDelayMs: 10000, // 10 seconds

  /**
   * tag to identify periodic sync events for inertia offline refresh; must
   * match tags used in SW maintenance handler config
   */
  periodicSyncTag: 'inertia-refresh:default',

  /**
   * path or URL to do a sanity check for connectivity (e.g. wifi connected but
   * no internet); could be a lightweight endpoint that returns a 200 status
   */
  onlineCheckUrl: '/',
});

createPwa();

// manual triggers
postServiceWorkerMessage('CLEAR_OFFLINE');
postServiceWorkerMessage('REFRESH_EXPIRED');
```

State exposed:
- `onlineAndConnected`: boolean (network+connectivity check)
- `showRefresh`: boolean (needs refresh prompt)
- `installEvent`: `BeforeInstallPromptEvent` if available
- `updateSW`: function from `registerSW`

---

## Example setup (Vue + Vite PWA)

### service worker (`resources/js/service-worker.js`)

```js
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { createOfflineFetchHandler, createOfflineMaintenanceHandlers, setDebugLogging } from 'inertia-offline/sw';

// enable debug logging in dev
setDebugLogging(import.meta.env.DEV);

const fetchHandler = createOfflineFetchHandler();
const {
	warmRouteCacheabilityIndex,
	handleMessageEvent,
	handlePeriodicSyncEvent,
	handlePushEvent
} = createOfflineMaintenanceHandlers();

// clean up old precaches automatically
cleanupOutdatedCaches()

// this is injected by vite-plugin-pwa at build time
// DO NOT touch at runtime
precacheAndRoute(self.__WB_MANIFEST || [])

// take control of all unclaimed clients/pages immediately
self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		await warmRouteCacheabilityIndex()
		await self.clients.claim()
	})())
})

// intercept requests made by the frontend
self.addEventListener('fetch', (event) => {
	fetchHandler(event);
});

// listen for messages from frontend
self.addEventListener('message', (event) => {
	const { type } = event.data || {};

	// from vite pwa/workbox update handling
	// see https://vite-pwa-org.netlify.app/guide/inject-manifest.html#service-worker-code-2
	if (type === 'SKIP_WAITING') {
		self.skipWaiting();
		return;
	}

	handleMessageEvent(event);
});

// periodic sync handler (chrome / android pwa)
self.addEventListener('periodicsync', (event) => {
	handlePeriodicSyncEvent(event);
});

// push handler
self.addEventListener('push', (event) => {
	handlePushEvent(event);
});
```

### app (`resources/js/app.js`)

At a minimum, you need to import the `registerSW` function from `virtual:pwa-register` and call `createPwa()` from `usePwa` to set up the SW registration and lifecycle handling.

The example below also includes how to trigger refreshes after login/logout, use `postServiceWorkerMessage()` to send messages to the SW.

```js
import { createApp, h, watch } from 'vue'
import { createInertiaApp, usePage } from '@inertiajs/vue3'
import { registerSW } from 'virtual:pwa-register';
import { usePwa } from 'inertia-offline/vue';

// pwa/service worker setup
const { createPwa, postServiceWorkerMessage } = usePwa({ registerSW });
createPwa();

createInertiaApp({
	resolve: (name) => {
		const pages = import.meta.glob('../views/Pages/**/*.vue', { eager: true });
		let page = pages[`../views/Pages/${name}.vue`];
		return page;
	},
	setup({ el, App, props, plugin }) {
		createApp({ render: () => h(App, props) })
			.use(plugin)
			.mount(el);

		// refresh cache after logging in or out
		// assumes you have a boolean `_authed` shared prop from the backend
		const page = usePage();
		watch(() => page.props._authed, async (newStatus, oldStatus) => {
			// logging in
			if (newStatus && !oldStatus) {
				console.log('User logged in; rebuilding offline cache');
				postServiceWorkerMessage('CLEAR_OFFLINE');
				postServiceWorkerMessage('REFRESH_EXPIRED');
			}

			// logging out
			if (!newStatus && oldStatus) {
				console.log('User logged out; clearing offline cache');
				postServiceWorkerMessage('CLEAR_OFFLINE');
			}
		});
	},
});
```

### Vite config (`vite.config.ts`)

Most of your Vite config will be standard. The important takeaways from the example below are the image lists and the `VitePWA` plugin configuration.

```ts
import laravel from 'laravel-vite-plugin';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
	const manifestIcons = [
		{
			src: '/favicon-64x64.png',
			sizes: '64x64',
			type: 'image/png'
		},
		{
			src: '/android-chrome-192x192.png',
			sizes: '192x192',
			type: 'image/png'
		},
		{
			src: '/android-chrome-512x512.png',
			sizes: '512x512',
			type: 'image/png',
			purpose: 'any'
		},
		/* {
			src: '/maskable-icon-512x512.png',
			sizes: '512x512',
			type: 'image/png',
			purpose: 'maskable'
		} */
	];

	const publicIcons = [
		'/favicon.ico',
		//'/favicon.svg',
		'/apple-touch-icon.png'
	];

	const additionalImages = [];

	return {
		base: '/', // resolve bundled fonts at build time correctly regardless of laravel's config
		plugins: [
			laravel({
				input: 'resources/js/app.js',
				refresh: true,
			}),
			vue({
				template: {
					transformAssetUrls: {
						base: null,
						includeAbsolute: false,
					},
				},
			}),
			VitePWA({
				strategies: 'injectManifest', // required for custom SW
				srcDir: 'resources/js', // path to your custom SW file
				filename: 'service-worker.js', // filename for both the source and the output service worker
				outDir: 'public', // output the injected SW to public/ so it matches the /service-worker.js registration URL
				injectRegister: false, // we'll register the service worker manually in our app.js
				injectManifest: {
					globPatterns: ['**/*.{js,css,html,ico,jpg,png,svg,woff,woff2,ttf,eot}'], // automatically include matching files in the precache manifest (relative to base)
					globIgnores: ['service-worker.js'], // prevent the SW from precaching itself
					maximumFileSizeToCacheInBytes: 5000000, // 5 MB limit for precached files
				},
				//buildBase: '/', // base path for the built SW; should match the public path where the SW is served from
				scope: '/', // scope to control
				base: '/', // base path for the registered SW
				registerType: 'prompt', // don't register new SW until we explicitly call `updateSW` from `usePwa`
				devOptions: { // use SW in development for testing; workbox's precaching will not be injected
					enabled: true,
					type: 'module',
				},
				includeAssets: [ // include additional static assets in the manifest that aren't imported in the app
					...publicIcons,
					...additionalImages,
				],
				pwaAssets: { // see https://vite-pwa-org.netlify.app/assets-generator/
					disabled: true,
				},
				manifest: { // web manifest options
					name: 'Your App Name',
					short_name: 'Your App',
					description: 'Your App Description',
					theme_color: '#ffffff',
					background_color: '#ffffff',
					orientation: 'portrait',
					display: 'standalone',
					scope: '/', // scope to control; should match the SW scope
					start_url: '/', // must match the settings in the SW and app for offline caching to work correctly
					id: '/',
					icons: manifestIcons,
				},
			}),
		],
	};
});
```

---

## Service Worker contracts

Below are the message and API contracts between the SW and the app/backend for offline caching and maintenance behaviors. If you want to implement your own app or backend logic, these define how you can work with this package.

### 1. App → SW message contract

These are the messages that the frontend app can send to the SW. The SW listens for these messages in the `message` event listener and triggers the corresponding behaviors.

- `{'type': 'REFRESH_EXPIRED'}`
  - SW refreshes eligible resources via `refreshAllExpired()`
- `{'type': 'CLEAR_OFFLINE'}`
  - SW clears IndexedDB via `clearAllData()`

### 2. Backend API contract

These are the API endpoints that the SW expects the backend to implement for offline caching and maintenance behaviors. The SW makes requests to these endpoints as part of its fetch handling and maintenance routines. The paths indicated below are the package defaults, but can be configured in the respective SW handler options.

#### `GET /pwa/offline-version`

Returns the current Inertia version of the app.

```json
{
	"version": "x.y.z"
}
```

#### `GET /pwa/offline-routes`

Returns a list of routes to cache for offline use, along with cacheability metadata. The SW uses this list to determine which routes to cache and how to handle them when offline.

```json
{
	"ttl": <seconds>,
	"routes": [
		{
			"url": "/x",
			"ttl": 1200
		},
		...
	]
}
```

**Notes:**
- `ttl` is the minimum time in seconds between refresh checks for the respective item (route list and individual routes); after this, the next SW refresh process will attempt to refresh that item from the server.
- ETags and `If-None-Match` headers are supported for both the route list and individual routes, allowing for a simple `304 Not Modified` response when the item hasn't changed, eliminating unnecessary data transfer while keeping the cache up to date.
- Consistent with the patterns used by Inertia, the backend is responsible for including and excluding routes based on relevant criteria (e.g. auth, user role, etc.)
- When a route uses pagination, the backend is responsible for enumerating the paginated URLs and including each one in the list. From the perspective of this package, paginated routes are just regular routes with different URLs; there's no special handling or hierarchy.

---

## Limitations / TODOs

- read-only only (no form submit queueing or data sync in this package)
- no auth policy baked in (application must handle auth data freshness)
- supports only normal Inertia visits (no partial reloads, lazy loaded components, etc.)

Enhancements to consider:
- support for other frontend frameworks (React, Svelte, etc.)
- add support for more inertia request types (partial reloads, lazy loaded components, etc.)

---

## Thanks

Thanks to [@sfreytag](https://github.com/sfreytag) for his work on [`laravel-vite-pwa`](https://github.com/sfreytag/laravel-vite-pwa). His work there on SW registration and Vite integration inspired some of the approach here.

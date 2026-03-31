# inertia-offline

> Beta: offline read-only layer for Inertia.js apps, focused on safe cached content and navigation fallback.

## Intro

`inertia-offline` is a service worker utility package for Inertia.js apps that enables read-only offline behavior with a Vue composable for state, connectivity, and periodic refresh orchestration.

### Goals:
  - offline read-only Inertia route caching
  - offline navigation fallback
  - Inertia version validation and stale cache eviction
  - route list cacheability metadata handling
  - support for ETag-based conditional requests and 304 handling
  - periodic refresh by `PeriodicSync`, fallback timers, push and explicit command

### Why Read-only?

Writing while offline (forms, mutations) is app-specific and requires custom conflict/resume logic, backend policies, and UX choices.

`inertia-offline` intentionally supports read-only caching and navigation behaviors.

If you need writes, implement them in your own service worker (see SW setup). This package exposes `createOfflineFetchHandler(options)` for request path handling. You can add custom handlers in your SW before/after the built-in path.

### Storage Efficiency

Because we're caching the Inertia page responses, there's a good chance that the browser's offline storage will become bloated, especially if your app has a lot of shared props. This is because there's no database normalization or deduplication, like you would (hopefully) have in your backend. If storage is a concern, consider implementing your own service worker that can implement a more sophisticated caching strategy.

---

## Setup Service Worker

You must add a service worker script and wire event listeners.

### 1. Install

```bash
npm install @inventor96/inertia-offline
```

### 2. Service Worker module imports

```js
import {
  createOfflineFetchHandler,
  createOfflineMaintenanceHandlers,
} from 'inertia-offline/sw';
```

### 3. Configure

```js
const fetchHandler = createOfflineFetchHandler({
  // must match your app's start_url in manifest and SW scope
  startUrl: '/',

  // if the server responds with one of these, treat as offline and serve from cache if available
  offlineFallbackStatuses: new Set([502, 503, 504]),

  // custom offline HTML builder for non-Inertia routes (e.g. static pages, or a custom offline page)
  buildOfflineHtml: ({ path }) => `...`,

  // array of custom request handlers, run after built-in inertia handling, but before navigation and non-Inertia XHR handling
  customHandlers: [async (ctx) => { return null; }],
});

const maintenanceHandlers = createOfflineMaintenanceHandlers({
  // tags to identify periodic sync events for inertia offline refresh; must match tags used in `usePwa` config
  periodicSyncTags: new Set(['inertia-refresh', 'inertia-refresh:default']),

  // push event data type to identify refresh event
  pushRefreshType: 'refresh-offline',

  // path from which to fetch the Inertia template HTML
  templateFetchPath: '/',

  // selector to identify the element in the template HTML that has the Inertia page data
  templateElementSelector: '[data-page]',
});
```

### 4. Event listeners

```js
self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		await maintenanceHandlers.warmRouteCacheabilityIndex()
		await self.clients.claim() // recommended SW best practice
	})())
});

self.addEventListener('fetch', (event) => {
  if (fetchHandler(event)) return;
});

self.addEventListener('message', (event) => {
  if (maintenanceHandlers.handleMessageEvent(event)) return;
});

self.addEventListener('periodicsync', (event) => {
  if (maintenanceHandlers.handlePeriodicSyncEvent(event)) return;
});

self.addEventListener('push', (event) => {
  if (maintenanceHandlers.handlePushEvent(event)) return;
});
```

### 5. Optional: custom write handlers

Handle POST/PATCH/PUT locally, queue in IndexedDB, sync when online. Not part of this package, but can plug into `fetch` event before `fetchHandler(event)`, `customHandlers` array, or after `fetchHandler` returns false.

---

## App Setup

### Recommended: Vite + `vite-plugin-pwa`

`usePwa()` is built around `virtual:pwa-register`; using Vite PWA gives smooth registration and auto-update.

If you want to handle your own service worker registration and messaging, this dependency is not required.

### Vue composable

```ts
import { usePwa } from 'inertia-offline/vue';

const {
  createPwa,
  postServiceWorkerMessage,
  onlineAndConnected,
  showRefresh,
  installEvent,
  updateSW,
} = usePwa({
  // how often update checks and refreshes should occur
  refreshIntervalMs: 900000,

  // initial delay before first update check and refresh
  initialRefreshDelayMs: 10000,

  // tag to identify periodic sync events for inertia offline refresh; must match tags used in SW maintenance handler config
  periodicSyncTag: 'inertia-refresh:default',

  // path or URL to do a sanity check for connectivity (e.g. wifi connected but no internet)
  onlineCheckUrl: '/',
});

createPwa();

// manual triggers
postServiceWorkerMessage('REFRESH_EXPIRED');
postServiceWorkerMessage('CLEAR_OFFLINE');
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

const handleOfflineFetch = createOfflineFetchHandler();
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
	handleOfflineFetch(event);
});

// listen for messages from frontend
self.addEventListener('message', (event) => {
	const { type } = event.data || {};

	// from vite pwa/workbox update handling
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

```js
import { createApp, h, watch } from 'vue'
import { createInertiaApp, usePage } from '@inertiajs/vue3'
import { usePwa } from 'inertia-offline/vue';

// PWA setup
const { createPwa, postServiceWorkerMessage } = usePwa();
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
		// assumes you have a boolean `_authed` shared prop in the backend
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
				strategies: 'injectManifest',
				srcDir: 'resources/js',
				filename: 'service-worker.js',
				outDir: 'public', // output the injected SW to public/ so it matches the /service-worker.js registration URL
				injectRegister: false, // we'll register the service worker manually in our app.js
				injectManifest: {
					globPatterns: ['**/*.{js,css,html,ico,jpg,png,svg,woff,woff2,ttf,eot}'],
					globIgnores: ['service-worker.js'], // prevent the SW from precaching itself
					maximumFileSizeToCacheInBytes: 5000000,
				},
				//buildBase: '/',
				scope: '/',
				base: '/',
				registerType: 'prompt',
				devOptions: {
					enabled: true,
					type: 'module',
				},
				includeAssets: [
					...publicIcons,
					...additionalImages,
				],
				pwaAssets: {
					disabled: true,
				},
				manifest: {
					name: 'Your App Name',
					short_name: 'Your App',
					description: 'Your App Description',
					theme_color: '#ffffff',
					background_color: '#ffffff',
					orientation: 'portrait',
					display: 'standalone',
					scope: '/',
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

### 1. App → SW message contract

- `{'type': 'REFRESH_EXPIRED'}`
  - SW refreshes eligible resources via `refreshAllExpired()`
- `{'type': 'CLEAR_OFFLINE'}`
  - SW clears IndexedDB via `clearAllData()`

Use `postServiceWorkerMessage('REFRESH_EXPIRED')` from `usePwa`.

### 2. Backend API contract

#### `/pwa/offline-version`

- `GET` returns `{ "version": "x.y.z" }`
- Required for `ensureInertiaVersion`.
- Path can be configured in `createOfflineFetchHandler` options.

#### `/pwa/offline-routes`

- `GET` returns `{ "ttl": <seconds>, "routes": [ { "url": "/x", "paginated": false, "ttl": 1200 }, ... ] }
- `getRouteList()` uses `If-None-Match` with ETag and caches route meta.
- Path can be configured in `createOfflineFetchHandler` options.

---

## Limitations / TODOs

- read-only only (no form submit queueing or data sync in this package)
- no auth policy baked in (application must handle auth data freshness)
- supports only normal Inertia visits (no partial reloads, lazy loaded components, etc.)

Enhancements to consider:
- support for other frontend frameworks (React, Svelte, etc.)
- add support for more inertia request types (partial reloads, lazy loaded components, etc.)

---

## Contributing

1. Fork repository
2. Create feature branch
3. Validate with `npm run build`
4. Open PR with use case and code

Please include:
- frontend framework/version
- service worker registration strategy
- backend controller endpoints
- offline repro scenario

---

## Notes

- service worker path decisions (start_url, template fetch path, etc.) can be configured in `createOfflineFetchHandler` / `createOfflineMaintenanceHandlers` / `usePwa`.
- Template path default is `/`; to use a stripped-down template use `templateFetchPath` option and your own route returning Minimal HTML with `[data-page]`.

import {
    installEvent,
    onlineAndConnected,
    showRefresh,
    swRegistration,
    updateSW,
} from './state.js';
import { logDebug, logWarn } from '../core/utils.js';
import type {
    BeforeInstallPromptEvent,
    UsePwaOptions,
} from '../core/types.js';

const DEFAULT_PERIODIC_SYNC_TAG = 'inertia-refresh:default';
const DEFAULT_REFRESH_INTERVAL_MS = 900000;
const DEFAULT_INITIAL_REFRESH_DELAY_MS = 10000;
const DEFAULT_ONLINE_CHECK_URL = '/';

/**
 * The timer ID for the fallback refresh timer.
 */
let refreshFallbackTimerId: number | undefined;

const DEFAULT_SERVICE_WORKER_PATH = '/service-worker.js';

type SwRegistrarOptions = {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
};

function createServiceWorkerRegistrar(
    swPath: string,
    options: SwRegistrarOptions = {},
): (reloadPage?: boolean) => Promise<void> {
    const {
        onNeedRefresh,
        onOfflineReady,
        onRegistered,
        onRegisteredSW,
        onRegisterError,
    } = options;

    let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | undefined;

    const register = async () => {
        if (!('serviceWorker' in navigator)) {
            return undefined;
        }

        if (!registrationPromise) {
            registrationPromise = navigator.serviceWorker.register(swPath)
                .then((registration) => {
                    swRegistration.value = registration;

                    if (registration.waiting) {
                        onNeedRefresh?.();
                    }

                    registration.addEventListener('updatefound', () => {
                        const installing = registration.installing;
                        if (!installing) {
                            return;
                        }

                        installing.addEventListener('statechange', () => {
                            if (installing.state !== 'installed') {
                                return;
                            }

                            if (navigator.serviceWorker.controller) {
                                onNeedRefresh?.();
                                return;
                            }

                            onOfflineReady?.();
                        });
                    });

                    onRegistered?.(registration);
                    onRegisteredSW?.(swPath, registration);

                    return registration;
                })
                .catch((error) => {
                    onRegisterError?.(error);
                    return undefined;
                });
        }

        return registrationPromise;
    };

    void register();

    return async (reloadPage = true) => {
        const registration = await register();
        if (!registration) {
            return;
        }

        if (reloadPage) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            }, { once: true });
        }

        if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            return;
        }

        await registration.update();
    };
}

function resolveServiceWorkerRegistrar(options: UsePwaOptions): (opts?: SwRegistrarOptions) => (reloadPage?: boolean) => Promise<void> {
    const swPath = options.swPath ?? DEFAULT_SERVICE_WORKER_PATH;
    return (opts) => createServiceWorkerRegistrar(swPath, opts);
}

/**
 * An event handler for the beforeinstallprompt event, which is fired by the
 * browser when the PWA install prompt is ready to be shown. We capture this
 * event and store it in the installEvent ref so that the UI can use it to
 * trigger the PWA installation prompt at the right time. Note that this event
 * is not supported in all browsers (eg Safari for Mac and iOS).
 * @param event The beforeinstallprompt event, which is captured and stored in the installEvent ref so that the UI can use it to trigger the PWA installation prompt at the right time. Note that this event is not supported in all browsers (eg Safari for Mac and iOS).
 */
function onBeforeInstallPrompt(event: BeforeInstallPromptEvent) {
    installEvent.value = event;
}

/**
 * An event handler for when the user goes offline. This sets the
 * onlineAndConnected ref to false, which can be used by the UI to show an
 * offline message or take other appropriate action. Note that a browser can be
 * online (eg connected to WiFi) but not able to use the web (eg WiFi has dead
 * gateway). We use the onlineAndConnected ref to track if the user is both
 * online AND connected.
 */
function onOffline() {
    onlineAndConnected.value = false;
}

/**
 * An event handler for when the user goes online. This checks if the browser
 * is both online (has a network connection) and connected (the network
 * connection works) and sets the onlineAndConnected ref accordingly. Note that
 * a browser can be online (eg connected to WiFi) but not able to use the web
 * (eg WiFi has dead gateway). We use the onlineAndConnected ref to track if
 * the user is both online AND connected.
 */
function onOnline(checkUrl: string = DEFAULT_ONLINE_CHECK_URL) {
    getOnlineAndConnected(checkUrl);
}

/**
 * Checks if the browser is both online (has a network connection) and
 * connected (the network connection works) by making a fetch request to a
 * known endpoint. The result is stored in the onlineAndConnected ref, which
 * can be used by the UI to show an offline message or take other appropriate
 * action. Note that a browser can be online (eg connected to WiFi) but not
 * able to use the web (eg WiFi has dead gateway). We use the
 * onlineAndConnected ref to track if the user is both online AND connected.
 */
function getOnlineAndConnected(checkUrl: string = DEFAULT_ONLINE_CHECK_URL) {
    fetch(checkUrl, { cache: 'no-store' })
        .then((response) => {
            onlineAndConnected.value = navigator.onLine && response.status === 200;
        })
        .catch(() => {
            onlineAndConnected.value = false;
        });
}

/**
 * Gets the active service worker for sending messages.
 * @returns The service worker instance.
 */
function getMessageWorker() {
    return navigator.serviceWorker.controller ?? swRegistration.value?.active;
}

/**
 * Posts a message to the service worker with the specified type. This can be used to trigger actions in the service worker, such as checking for updates or refreshing cached content. If there is no active service worker to post the message to, this function returns false.
 * @param type The type of message to post to the service worker.
 * @returns true if the message was posted to the service worker, false if there was no active service worker to post the message to.
 */
function postServiceWorkerMessage(type: string) {
    const worker = getMessageWorker();
    if (!worker) {
        return false;
    }

    worker.postMessage({ type });
    return true;
}

/**
 * Posts a message to the service worker to trigger a check for updates and refresh if necessary.
 * @returns true if the message was posted to the service worker, false if there was no active service worker to post the message to.
 */
function postRefreshExpired() {
    return postServiceWorkerMessage('REFRESH_EXPIRED');
}

/**
 * Starts a timer for triggering refresh checks at a specified interval.
 * This is used when the browser does not support the Periodic Background Sync API.
 * @param refreshIntervalMs The interval in milliseconds at which to trigger refresh checks. If null, periodic refresh checks are disabled.
 * @returns void
 */
function startRefreshFallbackTimer(refreshIntervalMs: number) {
    // Don't start the timer if it's already running
    if (refreshFallbackTimerId) {
        return;
    }

    refreshFallbackTimerId = window.setInterval(() => {
        // check if we're online before trying to post the message to the service worker
        if (!navigator.onLine || !onlineAndConnected.value) {
            return;
        }

        // post the REFRESH_EXPIRED message to the service worker
        const posted = postRefreshExpired();
        if (!posted) {
            logDebug('REFRESH_EXPIRED fallback skipped (no active worker)');
        }
    }, refreshIntervalMs);

    logDebug(`Using fallback refresh timer (${refreshIntervalMs}ms)`);
}

/**
 * Registers a periodic sync with the service worker if supported by the browser.
 * @param registration The service worker registration object.
 * @param refreshIntervalMs The interval in milliseconds at which to trigger refresh checks.
 * @param periodicSyncTag The tag to use for the periodic sync.
 * @returns A boolean or a promise that resolves to a boolean indicating whether the periodic sync was successfully registered.
 */
function registerPeriodicSync(
    registration: ServiceWorkerRegistration,
    refreshIntervalMs: number,
    periodicSyncTag: string,
): boolean | Promise<boolean> {
    // define a type that includes the periodicSync property if it's supported by the browser
    type PeriodicSyncCapableRegistration = ServiceWorkerRegistration & {
        periodicSync?: {
            register: (tag: string, options: { minInterval: number }) => Promise<void>;
        }
    };

    // cast the registration to the extended type that includes periodicSync (if supported)
    const withPeriodicSync = registration as PeriodicSyncCapableRegistration;
    if (!withPeriodicSync.periodicSync) {
        logDebug('Periodic sync not supported in this browser');
        return false;
    }

    // register the periodic sync with the specified tag and interval
    return withPeriodicSync.periodicSync
        .register(periodicSyncTag, {
            minInterval: refreshIntervalMs,
        })
        .then(() => {
            logDebug(`Periodic sync registered (${periodicSyncTag}, ${refreshIntervalMs}ms)`);
            return true;
        })
        .catch((error) => {
            logWarn('Periodic sync registration failed:', error);
            return false;
        });
}

/**
 * Handles the service worker registration and sets up periodic sync or fallback timer as needed.
 * @param options The options for configuring the PWA behavior
 * @returns void
 */
function handleServiceWorkerRegistration(options: UsePwaOptions) {
    const {
        refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
        periodicSyncTag = DEFAULT_PERIODIC_SYNC_TAG,
    } = options;
    navigator.serviceWorker.ready
        .then(async (registration) => {
            // store the registration
            swRegistration.value = registration;

            // early return if refreshIntervalMs is null (periodic refresh disabled)
            if (refreshIntervalMs === null || refreshIntervalMs <= 0) {
                logDebug('Periodic refresh disabled (refreshIntervalMs is null or non-positive)');
                return;
            }

            // try to register the periodic sync
            const periodicSyncRegistration = registerPeriodicSync(
                registration,
                refreshIntervalMs,
                periodicSyncTag,
            );

            // if the browser doesn't support periodic sync, start the fallback timer.
            if (typeof periodicSyncRegistration === 'boolean') {
                if (!periodicSyncRegistration) {
                    startRefreshFallbackTimer(refreshIntervalMs);
                }
                return;
            }

            // if the browser does support periodic sync, but registration
            // fails for some reason, start the fallback timer
            return periodicSyncRegistration.then((periodicSyncRegistered) => {
                if (!periodicSyncRegistered) {
                    startRefreshFallbackTimer(refreshIntervalMs);
                }
            });
        })
        .catch((error) => {
            // sw registration unavailable; start the fallback timer
            if (refreshIntervalMs === null || refreshIntervalMs <= 0) {
                logDebug('Periodic refresh disabled (refreshIntervalMs is null or non-positive)');
                return;
            }

            logWarn('Failed to access service worker registration; fallback timer enabled:', error);
            startRefreshFallbackTimer(refreshIntervalMs);
        });
}

/**
 * Queues a one-time refresh upon app boot after a specified delay.
 * @param options The options for configuring the PWA behavior
 * @returns void
 */
function queueInitialRefresh(options: UsePwaOptions) {
    const { initialRefreshDelayMs } = options;

    // skip if null
    if (initialRefreshDelayMs === null) {
        logDebug('Initial refresh check skipped (initialRefreshDelayMs is null)');
        return;
    }

    // do the queueing
    setTimeout(() => {
        // check if we're online
        if (!navigator.onLine || !onlineAndConnected.value) {
            return;
        }

        // check if a service worker update is pending
        if (swRegistration.value?.waiting) {
            // don't do it now, hopefully the user will update first and then we'll make it back here
            return;
        }

        // post the REFRESH_EXPIRED message to the service worker
        const posted = postRefreshExpired();
        if (!posted) {
            logDebug('Initial REFRESH_EXPIRED fallback skipped (no active worker)');
        }
    }, initialRefreshDelayMs);
}

/**
 * A composable function that sets up the necessary event listeners and service
 * worker registration for PWA functionality, including handling the
 * beforeinstallprompt event, tracking online/offline status, and managing
 * periodic refresh checks with a fallback timer if the Periodic Background
 * Sync API is not supported by the browser.
 * @param options The options for configuring the PWA behavior
 * @param options.refreshIntervalMs The interval in milliseconds at which to trigger refresh checks. If null, periodic refresh checks are disabled. Default is 900000 (15 minutes).
 * @param options.initialRefreshDelayMs The delay in milliseconds after app boot to trigger the initial refresh check. If null, the initial refresh check is disabled. Default is 10000 (10 seconds).
 * @param options.periodicSyncTag The tag to use for the periodic sync. Default is 'inertia-refresh:default'.
 * @returns An object containing the PWA functions and reactive state.
 */
export function usePwa(options: UsePwaOptions) {
    // resolve options with defaults
    options = {
        refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
        initialRefreshDelayMs: DEFAULT_INITIAL_REFRESH_DELAY_MS,
        periodicSyncTag: DEFAULT_PERIODIC_SYNC_TAG,
        onlineCheckUrl: DEFAULT_ONLINE_CHECK_URL,
        ...options,
    };

    /**
     * Initializes the PWA functionality by setting up event listeners for the
     * beforeinstallprompt, online, and offline events, registering the service
     * worker, and configuring periodic refresh checks with a fallback timer if
     * necessary. This function should be called once during app initialization
     * to ensure that the PWA features are properly set up. If the function is
     * called multiple times, it will prevent re-initialization.
     * @returns void
     */
    function createPwa() {
        // prevent multiple initializations
        if (window.__PWA_INITIALIZED__) {
            logDebug('Already initialized');
            return;
        }
        window.__PWA_INITIALIZED__ = true;

        // capture the install event and put it in the store for later
        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

        // register the service worker and store the update function in the ref for later
        const registerServiceWorker = resolveServiceWorkerRegistrar(options);
        updateSW.value = registerServiceWorker({
            // logging
            onRegisteredSW(swUrl, registration) {
                logDebug(`Service worker registration succeeded (${swUrl}):`, registration);
            },
            onRegisterError(error) {
                logWarn('Service worker registration failed:', error);
            },
            onOfflineReady() {
                logDebug('Offline ready!');
            },

            // a new service worker has been installed and is waiting to activate
            onNeedRefresh() {
                showRefresh.value = true;
            },
        });

        // online/offline event handlers
        window.addEventListener('offline', onOffline);
        window.addEventListener('online', () => onOnline(options.onlineCheckUrl));

        // initial check to see if we're online and connected
        getOnlineAndConnected(options.onlineCheckUrl);

        // service worker setup
        if ('serviceWorker' in navigator) {
            handleServiceWorkerRegistration(options);
            queueInitialRefresh(options);
        } else {
            logWarn('Service workers are not supported in this browser; offline functionality and periodic refresh will not work');
        }
    }

    return { createPwa, postServiceWorkerMessage, updateSW, installEvent, showRefresh, onlineAndConnected };
}
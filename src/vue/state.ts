// Global (module-level) state. This could go in a Pinia store, too.

import { ref } from 'vue';
import type { BeforeInstallPromptEvent } from '../core/types.js';

// The PWA install event, which is captured and stored here so that we can
// control the install process.
const installEvent = ref<BeforeInstallPromptEvent | undefined>(undefined);

// If the service worker detects a new version of the app exists, this flag
// is set to true and we can use it to prompt the user to update the app.
const showRefresh = ref(false);

// The function to update the app.
const updateSW = ref<(reloadPage?: boolean | undefined) => Promise<void>>(() => {
    return Promise.reject()
});

// A browser can be online (eg connected to WiFi) but not able to use the
// web (eg WiFi has dead gateway). We use this state to track if the user
// is both online AND connected.
const onlineAndConnected = ref(true);

// Keep the current service worker registration in shared state so it can be
// used by periodic sync and fallback messaging.
const swRegistration = ref<ServiceWorkerRegistration | undefined>(undefined);

export {
    installEvent,
    showRefresh,
    updateSW,
    onlineAndConnected,
    swRegistration,
}
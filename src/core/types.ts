import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

declare global {
    interface Window {
        __PWA_INITIALIZED__?: boolean;
    }

    interface WindowEventMap {
        beforeinstallprompt: BeforeInstallPromptEvent;
    }
}

/**
 * The BeforeInstallPromptEvent is fired when the browser detects that your web
 * app meets the criteria to be installed as a PWA, but before the installation
 * prompt is shown to the user. This allows you to intercept the event and show
 * your own custom installation UI or defer the prompt until a more appropriate
 * time.
 * @see https://stackoverflow.com/a/67171375/3861550
 */
interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt(): Promise<void>;
}

type RegisterServiceWorker = (options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

interface UsePwaOptions {
    /** Interval in milliseconds for refreshing the PWA cache (default: 900000) */
    refreshIntervalMs?: number | null;
    /** Initial delay in milliseconds before the first refresh (default: 10000) */
    initialRefreshDelayMs?: number | null;
    /** Tag for periodic sync events (default: 'inertia-refresh') */
    periodicSyncTag?: string;
    /** URL for checking online status (default: '/') */
    onlineCheckUrl?: string;
}

export type { BeforeInstallPromptEvent, RegisterServiceWorker, UsePwaOptions };
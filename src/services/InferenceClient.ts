import { useAppStore } from '../store/useAppStore';

const PI_URL = "http://192.168.92.121:8080";

let pollingActive = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Poll /detections at ~5fps and update the store.
 */
export function startDetectionPolling() {
    if (pollingActive) return;
    pollingActive = true;
    poll();
}

export function stopDetectionPolling() {
    pollingActive = false;
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    // Clear detections when stopping
    useAppStore.getState().updateDetections([]);
}

async function poll() {
    if (!pollingActive) return;

    try {
        const response = await fetch(`${PI_URL}/detections`);
        if (response.ok) {
            const detections = await response.json();
            useAppStore.getState().updateDetections(detections);
        }
    } catch (e) {
        // Network error — skip this cycle
    }

    if (pollingActive) {
        pollTimer = setTimeout(poll, 200); // ~5fps
    }
}

/**
 * Send model switch command to Pi.
 */
export async function setRemoteModel(model: 'cone' | 'pothole' | 'off') {
    try {
        await fetch(`${PI_URL}/set_model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
        });
    } catch (e) {
        console.error('Failed to set model:', e);
    }
}

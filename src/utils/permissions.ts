/**
 * Utility functions for querying, requesting, and formatting
 * Camera and Microphone browser permissions.
 */

export type DevicePermissionType = 'camera' | 'microphone';
export type DevicePermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface DevicePermissionResult {
  state: DevicePermissionState;
  message?: string;
}

/**
 * Checks the current permission state using navigator.permissions.query.
 * Gracefully handles browsers that do not support permissions.query or
 * throw on 'camera' / 'microphone' PermissionName.
 */
export async function queryDevicePermission(
  type: DevicePermissionType,
): Promise<DevicePermissionState> {
  if (typeof navigator === 'undefined') {
    return 'unsupported';
  }

  if (navigator.permissions && typeof navigator.permissions.query === 'function') {
    try {
      const status = await navigator.permissions.query({
        name: type as unknown as PermissionName,
      });
      return (status.state as DevicePermissionState) || 'prompt';
    } catch {
      // Some browsers (e.g. Safari < 16, Firefox) throw TypeError for 'camera' / 'microphone'
      return 'prompt';
    }
  }

  return 'prompt';
}

/**
 * Requests device permission by briefly opening a media stream with getUserMedia,
 * then immediately stopping all active tracks.
 * The browser natively remembers the user's choice for the origin on HTTPS / localhost.
 */
export async function requestDevicePermission(
  type: DevicePermissionType,
): Promise<DevicePermissionResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      state: 'unsupported',
      message: 'Media devices are not supported in this browser environment.',
    };
  }

  try {
    const constraints: MediaStreamConstraints =
      type === 'camera'
        ? { video: { facingMode: 'environment' } }
        : { audio: true };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    // Immediately stop tracks so the device indicator (green/orange dot) turns off
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });

    return {
      state: 'granted',
      message: `${type === 'camera' ? 'Camera' : 'Microphone'} access granted and remembered by browser.`,
    };
  } catch (err: unknown) {
    const errorName = err instanceof Error ? err.name : '';
    const errorMsg = err instanceof Error ? err.message : String(err);

    const isDenied =
      errorName === 'NotAllowedError' ||
      errorName === 'PermissionDeniedError' ||
      errorMsg.toLowerCase().includes('denied') ||
      errorMsg.toLowerCase().includes('permission') ||
      errorMsg.toLowerCase().includes('not allowed');

    if (isDenied) {
      return {
        state: 'denied',
        message: `${type === 'camera' ? 'Camera' : 'Microphone'} access was blocked in browser settings.`,
      };
    }

    return {
      state: 'denied',
      message: `Unable to access ${type}: ${errorMsg}`,
    };
  }
}

/**
 * Friendly step-by-step guidance for unblocking camera or microphone
 * permissions in modern browser settings (Chrome, Edge, Safari, Firefox).
 */
export function getPermissionBlockedGuide(type: DevicePermissionType): {
  title: string;
  steps: string[];
} {
  const deviceName = type === 'camera' ? 'Camera' : 'Microphone';
  return {
    title: `How to unblock ${deviceName} in your browser`,
    steps: [
      `Click the site settings / tune / lock icon on the left side of your browser address bar.`,
      `Find "${deviceName}" in the permissions list.`,
      `Change the setting from "Block" to "Allow".`,
      `Refresh the page or click "Check Status" below.`,
    ],
  };
}

/**
 * Returns human-readable label and visual styling classes for a permission state.
 */
export function formatPermissionStateBadge(state: DevicePermissionState): {
  label: string;
  badgeClass: string;
} {
  switch (state) {
    case 'granted':
      return {
        label: 'Granted',
        badgeClass:
          'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
      };
    case 'denied':
      return {
        label: 'Blocked / Denied',
        badgeClass:
          'bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800/60',
      };
    case 'prompt':
      return {
        label: 'Not Requested (Prompt)',
        badgeClass:
          'bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
      };
    case 'unsupported':
    default:
      return {
        label: 'Unavailable',
        badgeClass:
          'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
      };
  }
}

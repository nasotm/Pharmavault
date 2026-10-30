import { useCallback, useEffect, useState } from 'react';
import {
  queryDevicePermission,
  requestDevicePermission,
  type DevicePermissionState,
} from '../utils/permissions';

export interface UseDevicePermissionsResult {
  cameraStatus: DevicePermissionState;
  microphoneStatus: DevicePermissionState;
  isChecking: boolean;
  actionFeedback: string | null;
  requestCamera: () => Promise<DevicePermissionState>;
  requestMicrophone: () => Promise<DevicePermissionState>;
  refresh: () => Promise<void>;
  clearFeedback: () => void;
}

export function useDevicePermissions(): UseDevicePermissionsResult {
  const [cameraStatus, setCameraStatus] = useState<DevicePermissionState>('prompt');
  const [microphoneStatus, setMicrophoneStatus] = useState<DevicePermissionState>('prompt');
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsChecking(true);
    try {
      const [cam, mic] = await Promise.all([
        queryDevicePermission('camera'),
        queryDevicePermission('microphone'),
      ]);
      setCameraStatus(cam);
      setMicrophoneStatus(mic);
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Listen for permission status changes in supported browsers
  useEffect(() => {
    void refresh();

    if (
      typeof navigator === 'undefined' ||
      !navigator.permissions ||
      typeof navigator.permissions.query !== 'function'
    ) {
      return;
    }

    let isMounted = true;
    const cleanups: Array<() => void> = [];

    const attachListener = async (type: 'camera' | 'microphone') => {
      try {
        const status = await navigator.permissions.query({
          name: type as unknown as PermissionName,
        });
        if (!isMounted) return;

        const handleChange = () => {
          if (!isMounted) return;
          const nextState = (status.state as DevicePermissionState) || 'prompt';
          if (type === 'camera') {
            setCameraStatus(nextState);
          } else {
            setMicrophoneStatus(nextState);
          }
        };

        status.addEventListener('change', handleChange);
        cleanups.push(() => {
          status.removeEventListener('change', handleChange);
        });
      } catch {
        // Browser does not support listener for this permission name
      }
    };

    void attachListener('camera');
    void attachListener('microphone');

    return () => {
      isMounted = false;
      cleanups.forEach((fn) => fn());
    };
  }, [refresh]);

  const requestCamera = useCallback(async (): Promise<DevicePermissionState> => {
    setActionFeedback(null);
    const result = await requestDevicePermission('camera');
    setCameraStatus(result.state);
    if (result.message) {
      setActionFeedback(result.message);
    }
    return result.state;
  }, []);

  const requestMicrophone = useCallback(async (): Promise<DevicePermissionState> => {
    setActionFeedback(null);
    const result = await requestDevicePermission('microphone');
    setMicrophoneStatus(result.state);
    if (result.message) {
      setActionFeedback(result.message);
    }
    return result.state;
  }, []);

  const clearFeedback = useCallback(() => {
    setActionFeedback(null);
  }, []);

  return {
    cameraStatus,
    microphoneStatus,
    isChecking,
    actionFeedback,
    requestCamera,
    requestMicrophone,
    refresh,
    clearFeedback,
  };
}

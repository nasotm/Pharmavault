import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPermissionStateBadge,
  getPermissionBlockedGuide,
  queryDevicePermission,
  requestDevicePermission,
} from './permissions';

test('formatPermissionStateBadge returns expected labels and badge styles', () => {
  assert.equal(formatPermissionStateBadge('granted').label, 'Granted');
  assert.ok(formatPermissionStateBadge('granted').badgeClass.includes('emerald'));

  assert.equal(formatPermissionStateBadge('denied').label, 'Blocked / Denied');
  assert.ok(formatPermissionStateBadge('denied').badgeClass.includes('rose'));

  assert.equal(formatPermissionStateBadge('prompt').label, 'Not Requested (Prompt)');
  assert.ok(formatPermissionStateBadge('prompt').badgeClass.includes('amber'));

  assert.equal(formatPermissionStateBadge('unsupported').label, 'Unavailable');
});

test('getPermissionBlockedGuide returns structured guidance for camera and microphone', () => {
  const cameraGuide = getPermissionBlockedGuide('camera');
  assert.equal(cameraGuide.title, 'How to unblock Camera in your browser');
  assert.ok(cameraGuide.steps.length >= 3);
  assert.ok(cameraGuide.steps[1].includes('Camera'));

  const micGuide = getPermissionBlockedGuide('microphone');
  assert.equal(micGuide.title, 'How to unblock Microphone in your browser');
  assert.ok(micGuide.steps[1].includes('Microphone'));
});

test('queryDevicePermission handles environments without navigator gracefully', async () => {
  // In node.js test environment, navigator.permissions may be missing or mocked
  const result = await queryDevicePermission('camera');
  assert.ok(['granted', 'denied', 'prompt', 'unsupported'].includes(result));
});

test('requestDevicePermission handles environments without mediaDevices gracefully', async () => {
  const result = await requestDevicePermission('camera');
  assert.ok(['granted', 'denied', 'prompt', 'unsupported'].includes(result.state));
});

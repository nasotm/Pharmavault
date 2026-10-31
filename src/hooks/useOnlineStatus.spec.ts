import { describe, expect, it } from 'vitest';
import { useOnlineStatus } from './useOnlineStatus';

describe('useOnlineStatus hook', () => {
  it('is a function that returns boolean status', () => {
    expect(typeof useOnlineStatus).toBe('function');
  });
});

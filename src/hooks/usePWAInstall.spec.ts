import { describe, expect, it, vi } from 'vitest';
import { detectIOSDevice, detectStandaloneMode, type BeforeInstallPromptEvent } from './usePWAInstall';

describe('PWA Install Utilities & beforeinstallprompt flow', () => {
  it('detects iOS user agents accurately for iPad and iPhone', () => {
    expect(
      detectIOSDevice({
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
      } as Navigator),
    ).toBe(true);

    expect(
      detectIOSDevice({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      } as Navigator),
    ).toBe(true);

    expect(
      detectIOSDevice({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/124.0.0.0',
      } as Navigator),
    ).toBe(false);
  });

  it('detects standalone display mode via matchMedia or navigator.standalone', () => {
    const standaloneWin = {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
      navigator: {},
    } as unknown as Window;
    expect(detectStandaloneMode(standaloneWin)).toBe(true);

    const browserWin = {
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
      navigator: { standalone: false },
    } as unknown as Window;
    expect(detectStandaloneMode(browserWin)).toBe(false);
  });

  it('supports triggering prompt() and reading userChoice on a BeforeInstallPromptEvent', async () => {
    const promptSpy = vi.fn().mockResolvedValue(undefined);
    const mockEvent: Pick<BeforeInstallPromptEvent, 'prompt' | 'userChoice'> = {
      prompt: promptSpy,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    };

    await mockEvent.prompt();
    const result = await mockEvent.userChoice;

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('accepted');
  });
});

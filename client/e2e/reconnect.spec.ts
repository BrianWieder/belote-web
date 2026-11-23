import { test, expect, type Page, type BrowserContext } from '@playwright/test';

declare global {
  interface Window {
    __testPeerConnections?: RTCPeerConnection[];
  }
}

async function trackPeerConnections(page: Page) {
  await page.addInitScript(() => {
    const NativeRTCPeerConnection = window.RTCPeerConnection;
    const tracked: RTCPeerConnection[] = [];
    window.__testPeerConnections = tracked;

    class TrackedRTCPeerConnection extends NativeRTCPeerConnection {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        tracked.push(this);
      }
    }

    window.RTCPeerConnection = TrackedRTCPeerConnection;
  });
}

async function playOneFastTrick(hostPage: Page, guestPage: Page) {
  for (let play = 0; play < 2; play++) {
    const deadline = Date.now() + 10_000;
    let played = false;
    while (Date.now() < deadline) {
      const hostCard = hostPage.locator('button[data-playable]:not(:disabled)').first();
      if (await hostCard.isVisible().catch(() => false)) {
        const testId = await hostCard.getAttribute('data-testid');
        await hostCard.click();
        await expect(
          hostPage.locator(`button[data-playable][data-testid="${testId}"]`),
        ).toHaveCount(0);
        played = true;
        break;
      }

      const guestCard = guestPage.locator('button[data-playable]:not(:disabled)').first();
      if (await guestCard.isVisible().catch(() => false)) {
        const testId = await guestCard.getAttribute('data-testid');
        await guestCard.click();
        await expect(
          guestPage.locator(`button[data-playable][data-testid="${testId}"]`),
        ).toHaveCount(0);
        played = true;
        break;
      }

      await hostPage.waitForTimeout(30);
    }

    if (!played) {
      throw new Error('Neither player had a playable card within timeout');
    }
  }
}

async function expectTrickResolved(hostPage: Page, guestPage: Page, trickNumber: number) {
  await Promise.all([
    expect(hostPage.getByTestId('trick-counter')).toContainText(`Trick ${trickNumber}/16`),
    expect(guestPage.getByTestId('trick-counter')).toContainText(`Trick ${trickNumber}/16`),
    expect(hostPage.getByText(/Last trick won by/)).toBeVisible(),
    expect(guestPage.getByText(/Last trick won by/)).toBeVisible(),
  ]);
}

test.describe('In-place WebRTC reconnection', () => {
  let hostContext: BrowserContext;
  let guestContext: BrowserContext;
  let hostPage: Page;
  let guestPage: Page;

  test.beforeEach(async ({ browser }) => {
    hostContext = await browser.newContext();
    guestContext = await browser.newContext();
    hostPage = await hostContext.newPage();
    guestPage = await guestContext.newPage();
  });

  test.afterEach(async () => {
    await hostContext.setOffline(false).catch(() => {});
    await guestContext.setOffline(false).catch(() => {});
    await hostContext.close();
    await guestContext.close();
  });

  test('recovers mid-game in place after guest loses WebRTC and signaling connectivity', async () => {
    await trackPeerConnections(guestPage);

    // 1. Start a P2P match
    await hostPage.goto('/?seed=reconnect-e2e-1');
    await hostPage.getByTestId('create-room').click();
    const roomCodeEl = hostPage.getByTestId('room-code');
    await roomCodeEl.waitFor({ timeout: 10_000 });
    const roomCode = (await roomCodeEl.textContent())!.trim();

    await guestPage.goto(`/?join=${roomCode}`);
    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });

    // 2. Complete bidding (guest is non-dealer and acts first)
    await guestPage.getByTestId('bid-take').click();
    await hostPage.getByTestId('play-area').waitFor({ timeout: 10_000 });
    await guestPage.getByTestId('play-area').waitFor({ timeout: 10_000 });

    // 3. Play Trick 1 cleanly and verify both peers resolve it
    await playOneFastTrick(hostPage, guestPage);
    await expectTrickResolved(hostPage, guestPage, 1);

    const initialPcCount = await guestPage.evaluate(
      () => window.__testPeerConnections?.length ?? 0,
    );
    expect(initialPcCount).toBeGreaterThanOrEqual(1);

    // 4. Simulate a real mid-game drop on the guest: lose network + drop the active WebRTC PC
    await guestContext.setOffline(true);
    await guestPage.evaluate(() => {
      for (const pc of window.__testPeerConnections ?? []) {
        pc.close();
      }
    });

    // Guest shows the in-place reconnecting banner without leaving the game board
    await expect(guestPage.getByTestId('reconnecting-banner')).toBeVisible({ timeout: 10_000 });
    await expect(guestPage.getByTestId('game-board')).toBeVisible();

    // 5. Restore guest network -> Socket.IO reconnects, rejoin-room negotiates a fresh WebRTC PC
    await guestContext.setOffline(false);

    await expect(guestPage.getByTestId('reconnecting-banner')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(hostPage.getByTestId('reconnecting-banner')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(guestPage.getByTestId('disconnected-banner')).toHaveCount(0);
    await expect(hostPage.getByTestId('disconnected-banner')).toHaveCount(0);

    // Confirm a brand-new RTCPeerConnection was negotiated for the recovery
    const postReconnectPcCount = await guestPage.evaluate(
      () => window.__testPeerConnections?.length ?? 0,
    );
    expect(postReconnectPcCount).toBeGreaterThan(initialPcCount);

    // 6. Play Trick 2 across the recovered WebRTC connection and verify both peers resolve it
    await playOneFastTrick(hostPage, guestPage);
    await expectTrickResolved(hostPage, guestPage, 2);
  });

  test('recovers mid-game in place after host loses WebRTC and signaling connectivity', async () => {
    await trackPeerConnections(hostPage);

    await hostPage.goto('/?seed=reconnect-e2e-host');
    await hostPage.getByTestId('create-room').click();
    const roomCodeEl = hostPage.getByTestId('room-code');
    await roomCodeEl.waitFor({ timeout: 10_000 });
    const roomCode = (await roomCodeEl.textContent())!.trim();

    await guestPage.goto(`/?join=${roomCode}`);
    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });

    await guestPage.getByTestId('bid-take').click();
    await hostPage.getByTestId('play-area').waitFor({ timeout: 10_000 });
    await guestPage.getByTestId('play-area').waitFor({ timeout: 10_000 });

    await playOneFastTrick(hostPage, guestPage);
    await expectTrickResolved(hostPage, guestPage, 1);

    const initialPcCount = await hostPage.evaluate(
      () => window.__testPeerConnections?.length ?? 0,
    );
    expect(initialPcCount).toBeGreaterThanOrEqual(1);

    // Simulate mid-game network + WebRTC transport drop on the host
    await hostContext.setOffline(true);
    await hostPage.evaluate(() => {
      for (const pc of window.__testPeerConnections ?? []) {
        pc.close();
      }
    });

    await expect(hostPage.getByTestId('reconnecting-banner')).toBeVisible({ timeout: 10_000 });
    await expect(hostPage.getByTestId('game-board')).toBeVisible();

    // Restore host network -> host re-initiates WebRTC and pushes full state
    await hostContext.setOffline(false);

    await expect(hostPage.getByTestId('reconnecting-banner')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(guestPage.getByTestId('reconnecting-banner')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(hostPage.getByTestId('disconnected-banner')).toHaveCount(0);
    await expect(guestPage.getByTestId('disconnected-banner')).toHaveCount(0);

    const postReconnectPcCount = await hostPage.evaluate(
      () => window.__testPeerConnections?.length ?? 0,
    );
    expect(postReconnectPcCount).toBeGreaterThan(initialPcCount);

    await playOneFastTrick(hostPage, guestPage);
    await expectTrickResolved(hostPage, guestPage, 2);
  });
});

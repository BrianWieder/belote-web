import { test, expect, type Page, type BrowserContext } from '@playwright/test';

test.describe('Two-player Belote game', () => {
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
    await hostContext.close();
    await guestContext.close();
  });

  test('full game round: create room, join, bid, play 8 tricks, see round summary', async () => {
    // 1. Host creates a room
    await hostPage.goto('/');
    await hostPage.getByTestId('create-room').click();
    const roomCodeEl = hostPage.getByTestId('room-code');
    await roomCodeEl.waitFor({ timeout: 10_000 });
    const roomCode = (await roomCodeEl.textContent())!.trim();
    expect(roomCode).toMatch(/^[A-Z0-9]{4}$/);

    // 2. Guest joins the room
    await guestPage.goto('/');
    await guestPage.getByTestId('join-code-input').fill(roomCode);
    await guestPage.getByTestId('join-room').click();

    // 3. Both should see the game board (bidding phase)
    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });

    // 4. Bidding phase - someone must take for the game to proceed
    await completeBidding(hostPage, guestPage);

    // 5. Both should now be in the playing phase
    await hostPage.getByTestId('play-area').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('play-area').waitFor({ timeout: 15_000 });

    // 6. Play all 8 tricks
    for (let trick = 0; trick < 8; trick++) {
      await playOneTrick(hostPage, guestPage);
    }

    // 7. Round summary should appear
    await hostPage.getByTestId('round-summary').waitFor({ timeout: 10_000 });
    await guestPage.getByTestId('round-summary').waitFor({ timeout: 10_000 });

    // Verify the round summary shows "Round Over"
    await expect(hostPage.getByTestId('round-summary-title')).toHaveText('Round Over');
    await expect(guestPage.getByTestId('round-summary-title')).toHaveText('Round Over');

    // 8. Verify scoreboard is present
    await expect(hostPage.getByTestId('scoreboard')).toBeVisible();
    await expect(guestPage.getByTestId('scoreboard')).toBeVisible();
  });
});

/**
 * Complete the bidding phase. The first player with a turn clicks "Take" (round 1)
 * or chooses a suit (round 2).
 */
async function completeBidding(hostPage: Page, guestPage: Page) {
  const timeout = 15_000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // Check if we've already moved to the playing phase
    if (await hostPage.getByTestId('play-area').isVisible().catch(() => false)) return;
    if (await guestPage.getByTestId('play-area').isVisible().catch(() => false)) return;

    // Find who has the turn
    let turnPage: Page | null = null;
    if (await hostPage.getByTestId('your-turn-to-bid').isVisible().catch(() => false)) {
      turnPage = hostPage;
    } else if (await guestPage.getByTestId('your-turn-to-bid').isVisible().catch(() => false)) {
      turnPage = guestPage;
    }

    if (!turnPage) {
      await new Promise(r => setTimeout(r, 200));
      continue;
    }

    // Try to click Take (round 1)
    const takeBtn = turnPage.getByTestId('bid-take');
    if (await takeBtn.isVisible().catch(() => false)) {
      await takeBtn.click();
      try {
        await turnPage.getByTestId('play-area').waitFor({ timeout: 5_000 });
        return;
      } catch {
        // Continue the loop if it didn't transition
      }
    }

    // Try to choose a suit (round 2) - pick the first enabled suit button
    const suitBtn = turnPage.locator('[data-testid^="bid-suit-"]:not([disabled])').first();
    if (await suitBtn.isVisible().catch(() => false)) {
      await suitBtn.click();
      try {
        await turnPage.getByTestId('play-area').waitFor({ timeout: 5_000 });
        return;
      } catch {
        // Continue the loop
      }
    }

    await new Promise(r => setTimeout(r, 300));
  }

  throw new Error('Bidding did not complete within timeout');
}

/**
 * Find which page has a playable card (it's their turn to play).
 */
async function findPlayerWithPlayableCard(hostPage: Page, guestPage: Page, timeout: number): Promise<Page> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await hostPage.locator('[data-playable]').first().isVisible().catch(() => false)) return hostPage;
    if (await guestPage.locator('[data-playable]').first().isVisible().catch(() => false)) return guestPage;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Neither player has a playable card within timeout');
}

/**
 * Play one trick: identify whose turn it is, play a card, then do the same for the other player.
 */
async function playOneTrick(hostPage: Page, guestPage: Page) {
  const firstPlayer = await findPlayerWithPlayableCard(hostPage, guestPage, 10_000);
  await firstPlayer.locator('[data-playable]').first().click();
  await firstPlayer.waitForTimeout(300);

  const secondPlayer = await findPlayerWithPlayableCard(hostPage, guestPage, 10_000);
  await secondPlayer.locator('[data-playable]').first().click();
  await secondPlayer.waitForTimeout(500);
}

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

  test('full game round: create room, join, bid, play 16 tricks, see round summary', async () => {
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

    // 6. Play all 16 tricks
    for (let trick = 0; trick < 16; trick++) {
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

  test('jack turned up: non-dealer is forced to take, pass button is hidden', async () => {
    // jack-test-1 yields the Jack of diamonds as the trump card.
    await hostPage.goto('/?seed=jack-test-1');
    await hostPage.getByTestId('create-room').click();
    const roomCode = (await hostPage.getByTestId('room-code').textContent())!.trim();

    await guestPage.goto('/');
    await guestPage.getByTestId('join-code-input').fill(roomCode);
    await guestPage.getByTestId('join-room').click();

    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });

    // Host is the dealer (player 0); guest is the non-dealer (player 1) and must take.
    await expect(guestPage.getByTestId('your-turn-to-bid')).toHaveText('You must take');
    await expect(guestPage.getByTestId('bid-take')).toBeVisible();
    await expect(guestPage.getByTestId('bid-pass')).toHaveCount(0);
    await expect(hostPage.getByTestId('waiting-for-opponent')).toContainText(
      'Jack turned up — opponent must take',
    );

    // Take confirms and game proceeds to playing, showing the trump announcement.
    await guestPage.getByTestId('bid-take').click();
    await Promise.all([
      expect(hostPage.getByTestId('trump-announcement')).toContainText('Diamonds'),
      expect(guestPage.getByTestId('trump-announcement')).toContainText('Diamonds'),
    ]);
    await hostPage.getByTestId('play-area').waitFor({ timeout: 5_000 });
    await guestPage.getByTestId('play-area').waitFor({ timeout: 5_000 });
  });

  test('four passes: forced taker sees 8 hand cards before picking trump, tableau stays hidden', async () => {
    await hostPage.goto('/?seed=test');
    await hostPage.getByTestId('create-room').click();
    const roomCode = (await hostPage.getByTestId('room-code').textContent())!.trim();

    await guestPage.goto('/');
    await guestPage.getByTestId('join-code-input').fill(roomCode);
    await guestPage.getByTestId('join-room').click();

    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });

    const guestHandCards = guestPage.getByLabel('Your hand').locator('> div > div');
    const hostHandCards = hostPage.getByLabel('Your hand').locator('> div > div');

    // Both players start with 5 cards.
    await expect(guestHandCards).toHaveCount(5);
    await expect(hostHandCards).toHaveCount(5);

    // Round 1: both pass (guest is non-dealer and acts first).
    await guestPage.getByTestId('bid-pass').click();
    await hostPage.getByTestId('bid-pass').click();

    // Round 2: both pass -> forced bid for non-dealer (guest).
    await guestPage.getByTestId('bid-pass-round2').click();
    await hostPage.getByTestId('bid-pass-round2').click();

    // Guest sees their full 8-card hand (5 + top card + 2 from deck) and can pick any suit.
    await expect(guestPage.getByTestId('your-turn-to-bid')).toHaveText('You must choose trump');
    await expect(guestHandCards).toHaveCount(8);
    await expect(hostHandCards).toHaveCount(5);
    await expect(guestPage.locator('[data-testid^="bid-suit-"]:not([disabled])')).toHaveCount(4);
    await expect(guestPage.getByTestId('tableau-1')).toHaveCount(0);
    await expect(hostPage.getByTestId('tableau-0')).toHaveCount(0);

    // Choosing a suit deals host's remaining 3 cards and both tableaus, starting play.
    await guestPage.getByTestId('bid-suit-hearts').click();
    await hostPage.getByTestId('play-area').waitFor({ timeout: 5_000 });
    await guestPage.getByTestId('play-area').waitFor({ timeout: 5_000 });
    await expect(guestHandCards).toHaveCount(8);
    await expect(hostHandCards).toHaveCount(8);
    await expect(guestPage.getByTestId('tableau-1')).toBeVisible();
    await expect(hostPage.getByTestId('tableau-0')).toBeVisible();
  });

  test('host saves match in localStorage and resumes with a new room code', async () => {
    // 1. Start a match and play 2 tricks
    await hostPage.goto('/');
    await hostPage.getByTestId('create-room').click();
    const initialCode = (await hostPage.getByTestId('room-code').textContent())!.trim();

    await guestPage.goto('/');
    await guestPage.getByTestId('join-code-input').fill(initialCode);
    await guestPage.getByTestId('join-room').click();

    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });

    await completeBidding(hostPage, guestPage);
    await hostPage.getByTestId('play-area').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('play-area').waitFor({ timeout: 15_000 });

    await playOneTrick(hostPage, guestPage);
    await playOneTrick(hostPage, guestPage);
    // PlayArea keeps the last completed trick visible until the next lead is played.
    await expect(hostPage.getByTestId('trick-counter')).toContainText('Trick 2/16');

    // 2. Host reloads (simulating disconnect / returning later) and sees the saved game
    await hostPage.reload();
    await expect(hostPage.getByTestId('saved-game-card')).toBeVisible({ timeout: 5_000 });
    await expect(hostPage.getByTestId('saved-game-card')).toContainText('Trick 3/16');

    // 3. Host clicks Resume to get a fresh 4-character room code
    await hostPage.getByTestId('resume-game').click();
    const resumeCodeEl = hostPage.getByTestId('room-code');
    await resumeCodeEl.waitFor({ timeout: 10_000 });
    const resumeCode = (await resumeCodeEl.textContent())!.trim();
    expect(resumeCode).toMatch(/^[A-Z0-9]{4}$/);

    // 4. Guest reloads to the home screen and joins using the new code
    await guestPage.goto('/');
    await expect(guestPage.getByTestId('saved-game-card')).toHaveCount(0);
    await guestPage.getByTestId('join-code-input').fill(resumeCode);
    await guestPage.getByTestId('join-room').click();

    // 5. Both players hydrate straight back into the saved state without trump popup misfiring
    await hostPage.getByTestId('play-area').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('play-area').waitFor({ timeout: 15_000 });
    await expect(hostPage.getByTestId('trick-counter')).toContainText('Trick 2/16');
    await expect(guestPage.getByTestId('trick-counter')).toContainText('Trick 2/16');
    await expect(hostPage.getByTestId('trump-announcement')).toHaveCount(0);
    await expect(guestPage.getByTestId('trump-announcement')).toHaveCount(0);

    // 6. Playing the 3rd trick succeeds cleanly on both sides
    await playOneTrick(hostPage, guestPage);
    await expect(hostPage.getByTestId('trick-counter')).toContainText('Trick 3/16');
    await expect(guestPage.getByTestId('trick-counter')).toContainText('Trick 3/16');
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
    await new Promise(r => setTimeout(r, 30));
  }
  throw new Error('Neither player has a playable card within timeout');
}

/**
 * Play one trick: identify whose turn it is, play a card, then do the same for the other player.
 */
async function playOneTrick(hostPage: Page, guestPage: Page) {
  for (let i = 0; i < 2; i++) {
    const player = await findPlayerWithPlayableCard(hostPage, guestPage, 10_000);
    const card = player.locator('[data-playable]').first();
    const cardTestId = await card.getAttribute('data-testid');
    await card.click();
    if (cardTestId) {
      await expect(player.locator(`[data-playable][data-testid="${cardTestId}"]`)).toHaveCount(0);
    }
  }
}

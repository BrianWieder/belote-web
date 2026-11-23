import { test, expect, type Page } from '@playwright/test';

async function completeBiddingVsBot(page: Page) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('play-area').isVisible().catch(() => false)) {
      return;
    }

    if (await page.getByTestId('your-turn-to-bid').isVisible().catch(() => false)) {
      const takeBtn = page.getByTestId('bid-take');
      if (await takeBtn.isVisible().catch(() => false)) {
        await takeBtn.click();
      } else {
        const suitBtn = page.locator('[data-testid^="bid-suit-"]:not([disabled])').first();
        if (await suitBtn.isVisible().catch(() => false)) {
          await suitBtn.click();
        }
      }
    }

    await page.waitForTimeout(150);
  }

  throw new Error('Bot bidding did not complete within timeout');
}

async function playUntilRoundOrGameEnd(page: Page) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (
      (await page.getByTestId('round-summary').isVisible().catch(() => false)) ||
      (await page.getByTestId('game-over').isVisible().catch(() => false))
    ) {
      return;
    }

    const playable = page.locator('button[data-playable]:not(:disabled)').first();
    if (await playable.isVisible().catch(() => false)) {
      await playable.click().catch(() => {});
      await page.waitForTimeout(120);
      continue;
    }

    await page.waitForTimeout(120);
  }

  throw new Error('Bot round did not finish within timeout');
}

test.describe('Solo AI bot mode & local UX', () => {
  test('plays a full 16-trick round against Smart bot, inspects modals & last-trick peek, and deals next round', async ({
    page,
  }) => {
    await page.goto('/');

    // Configure player name, custom rules (500 + Capot), and Smart bot difficulty
    await page.getByTestId('player-name-input').fill('Alice');
    await page.getByTestId('table-rules-toggle').click();
    await expect(page.getByTestId('table-rules-panel')).toBeVisible();
    await page.getByTestId('target-score-500').click();
    await page.getByTestId('capot-toggle').click();
    await expect(page.getByTestId('capot-toggle')).toHaveAttribute('aria-checked', 'true');

    await page.getByTestId('bot-difficulty-smart').click();
    await expect(page.getByTestId('bot-difficulty-smart')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('play-vs-bot').click();

    // Game board starts with custom player name, Smart bot label, target score 500, and no P2P reactions
    await expect(page.getByTestId('game-board')).toBeVisible();
    const scoreboard = page.getByTestId('scoreboard');
    await expect(scoreboard).toContainText('Alice');
    await expect(scoreboard).toContainText('Bot (Smart)');
    await expect(scoreboard).toContainText('First to 500');
    await expect(page.getByTestId('reaction-button')).toHaveCount(0);

    // Open Rules modal before play and verify custom options are reflected
    await page.getByTestId('open-rules').click();
    await expect(page.getByTestId('rules-modal')).toBeVisible();
    await expect(page.getByTestId('rules-modal')).toContainText('500');
    await expect(page.getByTestId('rules-modal')).toContainText('Capot');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rules-modal')).toHaveCount(0);

    // Open Score Ledger modal before any completed round
    await page.getByTestId('open-score-ledger').click();
    await expect(page.getByTestId('score-ledger-modal')).toBeVisible();
    await expect(page.getByTestId('score-ledger-modal')).toContainText('No completed rounds yet.');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('score-ledger-modal')).toHaveCount(0);

    // Complete bidding and wait for playing phase
    await completeBiddingVsBot(page);
    await expect(page.getByTestId('play-area')).toBeVisible();

    // Play until the Last trick toggle appears (after trick 1 completes and trick 2 has a lead card)
    const peekDeadline = Date.now() + 15_000;
    while (Date.now() < peekDeadline) {
      if (await page.getByTestId('last-trick-toggle').isVisible().catch(() => false)) {
        break;
      }
      const playable = page.locator('button[data-playable]:not(:disabled)').first();
      if (await playable.isVisible().catch(() => false)) {
        await playable.click().catch(() => {});
        await page.waitForTimeout(150);
      } else {
        await page.waitForTimeout(120);
      }
    }

    await expect(page.getByTestId('last-trick-toggle')).toBeVisible();
    await page.getByTestId('last-trick-toggle').click();
    await expect(page.getByTestId('last-trick-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('last-trick-popover')).toHaveCount(0);

    // Play remaining tricks to end the round
    await playUntilRoundOrGameEnd(page);

    // In a 500-point match, 1 round is at most 272 points so round-summary is guaranteed
    await expect(page.getByTestId('round-summary')).toBeVisible();
    await expect(page.getByTestId('next-round')).toHaveText('Deal next round');
    await page.getByTestId('next-round').click();

    // Round 2 starts immediately in bot mode and ledger now records Round 1
    await expect(page.getByTestId('round-summary')).toHaveCount(0);
    await expect(scoreboard).toContainText('Round 2');
    await page.getByTestId('open-score-ledger').click();
    await expect(page.getByTestId('score-ledger-modal')).toBeVisible();
    await expect(page.getByTestId('score-ledger-modal')).not.toContainText('No completed rounds yet.');
    await page.keyboard.press('Escape');

    // Leaving bot mode returns cleanly to Lobby
    await page.getByTestId('leave-bot-game').click();
    await expect(page.getByTestId('create-room')).toBeVisible();
  });

  test('supports 2-tap card confirmation, Escape cancellation, and arrow-key card navigation', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('bot-difficulty-casual').click();
    await page.getByTestId('play-vs-bot').click();
    await expect(page.getByTestId('game-board')).toBeVisible();

    await completeBiddingVsBot(page);
    await expect(page.getByTestId('play-area')).toBeVisible();

    // Enable 2-tap play mode
    const twoTapBtn = page.getByTestId('two-tap-toggle');
    await twoTapBtn.click();
    await expect(twoTapBtn).toHaveAttribute('aria-pressed', 'true');

    // Wait for local player's turn with playable cards
    const firstPlayable = page.locator('button[data-playable]:not(:disabled)').first();
    await firstPlayable.waitFor({ timeout: 10_000 });
    const cardTestId = await firstPlayable.getAttribute('data-testid');
    expect(cardTestId).toBeTruthy();

    // First tap selects the card and shows hint without playing it
    await firstPlayable.click();
    await expect(page.getByTestId('two-tap-hint')).toBeVisible();
    await expect(page.getByTestId(cardTestId!)).toBeVisible();

    // Pressing Escape clears the 2-tap selection
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('two-tap-hint')).toHaveCount(0);

    // ArrowRight moves keyboard focus to a playable card
    await page.keyboard.press('ArrowRight');
    const focusedPlayable = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName === 'BUTTON' && el.hasAttribute('data-playable');
    });
    expect(focusedPlayable).toBe(true);

    // Tap twice on the same card to confirm play
    const targetCard = page.locator('button[data-playable]:not(:disabled)').first();
    const targetTestId = await targetCard.getAttribute('data-testid');
    await targetCard.click();
    await expect(page.getByTestId('two-tap-hint')).toBeVisible();
    await targetCard.click();

    // Selection hint clears and the played card leaves the playable hand/tableau
    await expect(page.getByTestId('two-tap-hint')).toHaveCount(0);
    await expect(
      page.locator(`button[data-playable][data-testid="${targetTestId}"]`),
    ).toHaveCount(0);
  });
});

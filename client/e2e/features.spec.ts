import { test, expect, type Page, type BrowserContext } from '@playwright/test';

async function completeP2PBidding(hostPage: Page, guestPage: Page) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (
      (await hostPage.getByTestId('play-area').isVisible().catch(() => false)) &&
      (await guestPage.getByTestId('play-area').isVisible().catch(() => false))
    ) {
      return;
    }

    let turnPage: Page | null = null;
    if (await hostPage.getByTestId('your-turn-to-bid').isVisible().catch(() => false)) {
      turnPage = hostPage;
    } else if (await guestPage.getByTestId('your-turn-to-bid').isVisible().catch(() => false)) {
      turnPage = guestPage;
    }

    if (turnPage) {
      const takeBtn = turnPage.getByTestId('bid-take');
      if (await takeBtn.isVisible().catch(() => false)) {
        await takeBtn.click().catch(() => {});
      } else {
        const suitBtn = turnPage.locator('[data-testid^="bid-suit-"]:not([disabled])').first();
        if (await suitBtn.isVisible().catch(() => false)) {
          await suitBtn.click().catch(() => {});
        }
      }
    }

    await hostPage.waitForTimeout(100);
  }

  throw new Error('P2P bidding did not complete within timeout');
}

async function playFullP2PRound(hostPage: Page, guestPage: Page) {
  const deadline = Date.now() + 30_000;
  const endSelector = '[data-testid="round-summary"], [data-testid="game-over"]';

  while (Date.now() < deadline) {
    const [hostPlayableId, guestPlayableId] = await Promise.all([
      hostPage.evaluate(
        () =>
          document
            .querySelector('button[data-playable]:not(:disabled)')
            ?.getAttribute('data-testid') ?? null,
      ),
      guestPage.evaluate(
        () =>
          document
            .querySelector('button[data-playable]:not(:disabled)')
            ?.getAttribute('data-testid') ?? null,
      ),
    ]);

    if (hostPlayableId) {
      await hostPage
        .locator(`button[data-playable][data-testid="${hostPlayableId}"]`)
        .click()
        .catch(() => {});
      await hostPage
        .locator(`button[data-playable][data-testid="${hostPlayableId}"]`)
        .waitFor({ state: 'detached', timeout: 5_000 })
        .catch(() => {});
      continue;
    }

    if (guestPlayableId) {
      await guestPage
        .locator(`button[data-playable][data-testid="${guestPlayableId}"]`)
        .click()
        .catch(() => {});
      await guestPage
        .locator(`button[data-playable][data-testid="${guestPlayableId}"]`)
        .waitFor({ state: 'detached', timeout: 5_000 })
        .catch(() => {});
      continue;
    }

    const [hostEnded, guestEnded] = await Promise.all([
      hostPage.locator(endSelector).first().isVisible().catch(() => false),
      guestPage.locator(endSelector).first().isVisible().catch(() => false),
    ]);
    if (hostEnded && guestEnded) {
      return;
    }

    await hostPage.waitForTimeout(25);
  }

  throw new Error('P2P round did not finish within timeout');
}

test.describe('P2P recent features (invite links, names, reactions, ready check, rematch)', () => {
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

  test('invite link ?join= auto-join, player name sync, table rules, and bistrot reactions', async () => {
    // Host enters name and custom table rules (500 + Capot) before creating room
    await hostPage.goto('/');
    await hostPage.getByTestId('player-name-input').fill('Claire');
    await hostPage.getByTestId('table-rules-toggle').click();
    await hostPage.getByTestId('target-score-500').click();
    await hostPage.getByTestId('capot-toggle').click();
    await hostPage.getByTestId('create-room').click();

    const roomCodeEl = hostPage.getByTestId('room-code');
    await roomCodeEl.waitFor({ timeout: 10_000 });
    const roomCode = (await roomCodeEl.textContent())!.trim();

    // Waiting screen displays the selected custom table rules
    await expect(hostPage.locator('main')).toContainText('First to 500');
    await expect(hostPage.locator('main')).toContainText('Capot (252 pts)');

    // Guest saves their display name, then opens the shareable ?join= invite link
    await guestPage.goto('/');
    await guestPage.getByTestId('player-name-input').fill('Marc');
    await guestPage.goto(`/?join=${roomCode}`);

    // Both players connect directly into the game board and ?join= is stripped from URL
    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await expect(guestPage).not.toHaveURL(/[?&]join=/);

    // Player names and target score 500 sync on both scoreboards
    await expect(hostPage.getByTestId('scoreboard')).toContainText('Claire');
    await expect(hostPage.getByTestId('scoreboard')).toContainText('Marc');
    await expect(hostPage.getByTestId('scoreboard')).toContainText('First to 500');
    await expect(guestPage.getByTestId('scoreboard')).toContainText('Marc');
    await expect(guestPage.getByTestId('scoreboard')).toContainText('Claire');
    await expect(guestPage.getByTestId('scoreboard')).toContainText('First to 500');

    // Host sends a bistrot reaction -> appears on host bottom pill and guest top pill
    await hostPage.getByTestId('reaction-button').click();
    await expect(hostPage.getByTestId('reaction-menu')).toBeVisible();
    await hostPage.getByTestId('reaction-option-bien-joue').click();
    await expect(hostPage.getByTestId('reaction-pill-bottom')).toHaveText('Bien joué !');
    await expect(guestPage.getByTestId('reaction-pill-top')).toHaveText('Bien joué !');

    // Guest sends a reaction back -> appears on guest bottom pill and host top pill
    await guestPage.getByTestId('reaction-button').click();
    await guestPage.getByTestId('reaction-option-merci').click();
    await expect(guestPage.getByTestId('reaction-pill-bottom')).toHaveText('Merci !');
    await expect(hostPage.getByTestId('reaction-pill-top')).toHaveText('Merci !');
  });

  test('mutual round-over ready check advances to round 2 and populates score ledger', async () => {
    await hostPage.goto('/?seed=ready-check-e2e');
    await hostPage.getByTestId('table-rules-toggle').click();
    await hostPage.getByTestId('target-score-500').click();
    await hostPage.getByTestId('create-room').click();
    const roomCode = (await hostPage.getByTestId('room-code').textContent())!.trim();

    await guestPage.goto(`/?join=${roomCode}`);
    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });

    await completeP2PBidding(hostPage, guestPage);
    await playFullP2PRound(hostPage, guestPage);

    await expect(hostPage.getByTestId('round-summary')).toBeVisible();
    await expect(guestPage.getByTestId('round-summary')).toBeVisible();

    // Host marks ready first -> waits while guest sees ready indicator
    await expect(hostPage.getByTestId('next-round')).toHaveText('Ready for next round');
    await hostPage.getByTestId('next-round').click();
    await expect(hostPage.getByTestId('next-round')).toBeDisabled();
    await expect(hostPage.getByTestId('next-round')).toHaveText('Waiting for opponent…');
    await expect(guestPage.getByTestId('opponent-round-ready')).toContainText('Opponent is ready');
    await expect(guestPage.getByTestId('next-round')).toHaveText('Deal next round');

    // Guest confirms -> both deal Round 2
    await guestPage.getByTestId('next-round').click();
    await expect(hostPage.getByTestId('round-summary')).toHaveCount(0);
    await expect(guestPage.getByTestId('round-summary')).toHaveCount(0);
    await expect(hostPage.getByTestId('scoreboard')).toContainText('Round 2');
    await expect(guestPage.getByTestId('scoreboard')).toContainText('Round 2');

    // Score ledger reflects Round 1 on host
    await hostPage.getByTestId('open-score-ledger').click();
    await expect(hostPage.getByTestId('score-ledger-modal')).toBeVisible();
    await expect(hostPage.getByTestId('score-ledger-modal')).not.toContainText('No completed rounds yet.');
  });

  test('live P2P rematch after completing a 500-point match', async () => {
    test.setTimeout(90_000);
    // rematch-fast-202 reaches 500+ in 3 rounds when taking round 1 and playing the first playable card.
    await hostPage.goto('/?seed=rematch-fast-202');
    await hostPage.getByTestId('table-rules-toggle').click();
    await hostPage.getByTestId('target-score-500').click();
    await hostPage.getByTestId('create-room').click();
    const roomCode = (await hostPage.getByTestId('room-code').textContent())!.trim();

    await guestPage.goto(`/?join=${roomCode}`);
    await hostPage.getByTestId('game-board').waitFor({ timeout: 15_000 });
    await guestPage.getByTestId('game-board').waitFor({ timeout: 15_000 });

    // Play rounds until one side reaches 500 and triggers game-over
    for (let round = 0; round < 10; round++) {
      await completeP2PBidding(hostPage, guestPage);
      await playFullP2PRound(hostPage, guestPage);

      if (await hostPage.getByTestId('game-over').isVisible().catch(() => false)) {
        break;
      }

      await hostPage.getByTestId('next-round').click();
      await guestPage.getByTestId('next-round').click();
      await expect(hostPage.getByTestId('round-summary')).toHaveCount(0);
      await expect(guestPage.getByTestId('round-summary')).toHaveCount(0);
    }

    await expect(hostPage.getByTestId('game-over')).toBeVisible();
    await expect(guestPage.getByTestId('game-over')).toBeVisible();

    // Guest initiates rematch -> host sees prompt and accepts
    await guestPage.getByTestId('play-rematch').click();
    await expect(guestPage.getByTestId('play-rematch')).toBeDisabled();
    await expect(guestPage.getByTestId('play-rematch')).toHaveText('Waiting for opponent…');
    await expect(hostPage.getByTestId('opponent-rematch-ready')).toContainText(
      'Opponent wants a rematch',
    );
    await expect(hostPage.getByTestId('play-rematch')).toHaveText('Accept rematch');

    await hostPage.getByTestId('play-rematch').click();

    // Fresh match begins on Round 1 with custom target score 500 preserved
    await expect(hostPage.getByTestId('game-over')).toHaveCount(0);
    await expect(guestPage.getByTestId('game-over')).toHaveCount(0);
    await expect(hostPage.getByTestId('scoreboard')).toContainText('Round 1');
    await expect(hostPage.getByTestId('scoreboard')).toContainText('First to 500');
    await expect(guestPage.getByTestId('scoreboard')).toContainText('Round 1');
    await expect(guestPage.getByTestId('scoreboard')).toContainText('First to 500');
  });
});

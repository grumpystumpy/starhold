/**
 * Dismiss the once-per-release What's new dialog in Playwright.
 * Real players still see it until they press Got it.
 *
 * Signed-in commanders use that button, which posts /api/whats-new/dismiss.
 * A page opened with ?commander= or ?playerId= has no session, and that
 * route answers 401. Those pages seed player.whatsNewDismissedReleaseId
 * through /api/e2e/grant (STARHOLD_E2E=1 only), then poll so the shell
 * drops the backdrop.
 */

const POPUP = '[data-testid="whats-new"]';
const DISMISS = '[data-testid="whats-new-dismiss"]';

async function hasSession(page) {
  const cookies = await page.context().cookies();
  return cookies.some((cookie) => cookie.name === "starhold_session" && cookie.value);
}

/** Account linked to this cookie, or null when the cookie does not own a commander. */
async function sessionPlayerId(page) {
  if (!(await hasSession(page))) return null;
  return page.evaluate(async () => {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const playerId = body?.account?.playerId;
    return typeof playerId === "string" && playerId ? playerId : null;
  });
}

async function seedDismissedRelease(page) {
  const playerId = await page.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  if (!playerId) {
    throw new Error("what's new is open but this page has no commander");
  }
  const status = await page.evaluate(async (id) => {
    const res = await fetch("/api/e2e/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ playerId: id, dismissWhatsNew: true }),
    });
    return res.status;
  }, playerId);
  if (status !== 200) {
    throw new Error(
      `what's new seed failed (${status}). STARHOLD_E2E=1 is required for a commander with no session.`,
    );
  }
  await page.evaluate(() => window.starhold?.poll?.());
}

/** Click Got it, or seed the save field when this commander has no session. */
export async function dismissWhatsNew(page) {
  const popup = page.locator(POPUP);
  if ((await popup.count()) === 0) return false;
  if (!(await popup.first().isVisible().catch(() => false))) return false;

  const playerId = await page.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  const ownerId = await sessionPlayerId(page);
  // Got it only works for the signed-in commander. A cookie from a
  // different account (or a signup that has not joined) is 401.
  if (playerId && ownerId === playerId) {
    // force skips the locator handler, so this click cannot re-enter it.
    await page.locator(DISMISS).click({ force: true, timeout: 5_000 });
    const gone = await popup
      .first()
      .waitFor({ state: "detached", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (gone) return true;
  }

  await seedDismissedRelease(page);
  await popup.first().waitFor({ state: "detached", timeout: 10_000 });
  return true;
}

/**
 * Before a click or an auto-waiting action, close What's new if it is
 * covering the shell. The dialog stays up until that action, so a test
 * can still assert it on a page that has not been armed.
 */
export async function armWhatsNewDismiss(page) {
  if (page.__starholdWhatsNewArmed) return page;
  page.__starholdWhatsNewArmed = true;
  await page.addLocatorHandler(page.locator(POPUP), async () => {
    await dismissWhatsNew(page);
  });
  return page;
}

export async function fleetToStep2(page, ships) {
  await page.waitForSelector('[data-testid="fleet-form"]');
  await page.waitForSelector('[data-testid="fleet-form"][data-fleet-step="1"]');
  for (const [type, count] of Object.entries(ships)) {
    await page.fill(`[data-testid="fleet-count-${type}"]`, String(count));
  }
  await page.click('[data-testid="fleet-next"]');
  await page.waitForSelector('[data-testid="fleet-form"][data-fleet-step="2"]');
  await page.waitForSelector(
    '[data-testid="fleet-form"][data-fleet-step="2"] [data-testid="launch-fleet"]',
  );
}

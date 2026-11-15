import { test, expect } from "@playwright/test";

function isLocalOrDataUrl(urlStr) {
  if (urlStr.startsWith("data:") || urlStr.startsWith("blob:") || urlStr.startsWith("about:")) {
    return true;
  }
  try {
    const u = new URL(urlStr);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

test("?demo=1 makes zero external network requests, transitions Orbit <-> HUD cleanly, and has zero uncaught errors", async ({ page }) => {
  const externalRequests = [];
  const pageErrors = [];

  page.on("pageerror", (err) => {
    pageErrors.push(String(err?.message || err));
  });

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (!isLocalOrDataUrl(url)) {
      externalRequests.push(url);
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto("/web/?demo=1", { waitUntil: "domcontentloaded" });

  // Wait for app initialization and verify demoSafe flag
  await page.waitForFunction(() => Boolean(window.__MM_APP__?.data?.demoSafe), null, { timeout: 30000 });

  // Dismiss start screen into Orbit View
  const orbitMenuBtn = page.locator('#start-menu [data-action="orbit"]');
  await orbitMenuBtn.click();

  await expect(page.locator("#orbit-view")).toHaveClass(/active/);
  await expect(page.locator("#badge-demo")).toBeVisible();

  // Switch from Orbit View to HUD View via top tab
  await page.locator("#btn-tab-hud").click();
  await expect(page.locator("#hud-view")).toHaveClass(/active/);

  // Switch back to Orbit View via HUD Orbit button
  await page.locator("#hud-orbit-btn").click();
  await expect(page.locator("#orbit-view")).toHaveClass(/active/);

  // Open Credits & Honesty modal and verify Preact rendered content
  await page.locator("#btn-credits").click();
  await expect(page.locator("#modal-backdrop")).toHaveClass(/open/);
  await expect(page.locator("#modal-body")).toContainText("Hassler et al.");
  await page.locator("#modal-close").click();

  // Open Settings modal and verify Tweakpane inspector mounted
  await page.locator("#btn-pad").click();
  await expect(page.locator("#modal-backdrop")).toHaveClass(/open/);
  await expect(page.locator("#tweakpane-graphics-mount")).toBeAttached();
  await page.locator("#modal-close").click();

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

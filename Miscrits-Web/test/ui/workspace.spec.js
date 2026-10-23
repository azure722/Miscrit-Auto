import { test as base, expect } from "@playwright/test";
import { createApp } from "../../server.mjs";

// Each test gets its own local backend and browser owner cookie. No game login.
const test = base.extend({
  workspace: async ({ page }, use) => {
    const app = await createApp({ port: 0, fetchData: false });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    await expect(page.locator("#hunt-grid .hunt-tile").first()).toBeVisible();
    try {
      await use(page);
    } finally {
      await page.close();
      await app.close();
    }
    expect(errors).toEqual([]);
  },
});

test("defaults to dark even with a light OS preference, persists light and dark choices", async ({
  workspace: page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("all navigation destinations render and retain unsaved controls across theme changes", async ({
  workspace: page,
}) => {
  for (const [tab, label] of [
    ["campaign", "Campaign"],
    ["arena", "Arena"],
    ["team", "Your team"],
    ["battle", "Live battle"],
    ["workflow", "Workflow"],
    ["collection", "Collection"],
    ["history", "Activity log"],
    ["hunt", "Hunt & capture"],
  ]) {
    const nav = page.locator(`nav [data-tab="${tab}"]`);
    await nav.click();
    await expect(nav).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#page-title")).toHaveText(label);
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();
    await expect(page.locator(".tab-panel:visible")).toHaveCount(1);
  }
  await page.locator("#threshold").fill("83");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("#threshold")).toHaveValue("83");
  await page.locator('nav [data-tab="team"]').click();
  await page.locator('nav [data-tab="hunt"]').click();
  await expect(page.locator("#threshold")).toHaveValue("83");
});

test("catalog filters and pagination work while signed out and login can be dismissed", async ({
  workspace: page,
}) => {
  await page.locator("#target-input").fill("Flue");
  await expect(page.locator("#hunt-grid .hunt-tile").first()).toContainText(
    "Flue",
  );
  expect(await page.locator("#hunt-grid .hunt-tile").count()).toBeLessThan(24);
  await page.locator("#target-input").fill("zzzz-no-miscrit");
  await expect(page.locator("#hunt-grid .hunt-tile")).toHaveCount(0);
  await page.locator("#target-input").fill("");
  await page.locator("#hunt-next").click();
  await expect(page.locator("#hunt-page")).toContainText("2 /");
  await page.locator("#hunt-prev").click();
  await expect(page.locator("#hunt-page")).toContainText("1 /");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#login-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#login-dialog")).not.toBeVisible();
  await expect(page.locator("#run")).toBeDisabled();
});

test("mobile layouts and every panel fit both themes without page overflow", async ({
  workspace: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["dark", "light"]) {
    if (theme === "light")
      await page.getByRole("button", { name: "Switch to light mode" }).click();
    for (const tab of [
      "hunt",
      "campaign",
      "arena",
      "team",
      "battle",
      "workflow",
      "collection",
      "history",
    ]) {
      await page.locator(`nav [data-tab="${tab}"]`).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${theme} ${tab} should fit mobile`,
      ).toBe(true);
    }
  }
});

import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createApp } from "../../server.mjs";
import { Engine } from "../../lib/engine.mjs";

const protocol = JSON.parse(
  readFileSync(new URL("../../data/protocol.json", import.meta.url)),
);
const catalog = JSON.parse(
  readFileSync(
    new URL(
      "../../../Auto-Capture-Game-Installer/source/capture_catalog.json",
      import.meta.url,
    ),
  ),
);
const test = base.extend({
  team: async ({ page }, use) => {
    const species = catalog.species.slice(0, 12);
    const p = {
      user_id: "team-fixture",
      username: "Trainer",
      level: 30,
      virtue: 100,
      gold: 2000,
      platinum: 40,
      team_order: [1, 2, 3, 4],
      battle: "",
      area: { area_id: 1, location: { name: "forest" } },
      left_traits: [],
      miscrits: Array.from({ length: 32 }, (_, index) => ({
        id: index + 1,
        mId: species[index % species.length].id,
        level: index === 2 ? 35 : (index % 3) + 10,
        exp: 60,
        hp: 3,
        chp: index === 0 ? 0 : 65,
        spd: 3,
        ea: 3,
        pa: 3,
        ed: 3,
        pd: 3,
        bonus_level: (index % 3) + 10,
        stats: { hp: 100 },
      })),
    };
    // Include duplicate owned copies to verify swapping by individual ID.
    p.miscrits[4].mId = p.miscrits[0].mId;
    const engine = new Engine({
      catalog,
      protocol,
      manualTeamManagement: true,
      config: { autoLevel: false },
    });
    const calls = [];
    engine.metadata = new Map(
      species.map((entry) => [
        entry.id,
        { ...entry, names: [entry.name], hp: "Elite", element: "Fire" },
      ]),
    );
    engine.player = structuredClone(p);
    engine.collectionIndex = {};
    engine.tick = async () => {};
    engine.transport = {
      connected: true,
      close() {},
      async rpc(id, value) {
        calls.push([id, value]);
        if (id === "get_player") return structuredClone(p);
        if (id === "update_team") {
          p.team_order = value.team;
          return {};
        }
        throw new Error("Unexpected game call in UI fixture: " + id);
      },
    };
    const app = await createApp({ port: 0, fetchData: false, engine });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:" + app.server.address().port);
    await page.locator('nav [data-tab="team"]').click();
    await expect(page.locator(".team-slot")).toHaveCount(4);
    await expect(page.locator(".inventory-tile").first()).toBeVisible();
    try {
      await use({ page, engine, p, calls });
    } finally {
      await page.close();
      await app.close();
      expect(errors).toEqual([]);
    }
  },
});

test("team settings are compact and save immediately, with gated per-copy platinum switches", async ({
  team: { page, engine },
}) => {
  await expect(
    page.getByText("Automatic team selection", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Eligible replacements", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("ROOM TO GROW", { exact: true })).toHaveCount(0);
  const master = page.getByRole("switch", {
    name: "Auto level-up",
    exact: true,
  });
  const platinum = page.getByRole("switch", { name: /Platinum upgrade/ });
  await expect(platinum).toHaveCount(4);
  for (const toggle of await platinum.all())
    await expect(toggle).toBeDisabled();
  await master.check();
  await expect(master).toBeChecked();
  await platinum.nth(1).check();
  await expect(platinum.nth(1)).toBeChecked();
  expect(engine.config.platinumUpgradeIds).toEqual([2]);
  expect(engine.config.autoLevel).toBe(true);
  await master.uncheck();
  await expect(master).not.toBeChecked();
  await expect(platinum.nth(1)).toBeDisabled();
  expect(engine.config.autoLevel).toBe(false);
});

test("HP and XP are real distinct bars with fainted and max-level labels", async ({
  team: { page },
}) => {
  const first = page.locator('[data-team-slot="0"]'),
    third = page.locator('[data-team-slot="2"]');
  await expect(first.locator(".health-meter progress")).toHaveAttribute(
    "value",
    "0",
  );
  await expect(first.locator(".health-meter")).toContainText("Fainted");
  await expect(first.locator(".health-meter")).toContainText("0 / 100");
  await expect(first.locator(".experience-meter progress")).toHaveAttribute(
    "value",
    "60",
  );
  await expect(third.locator(".experience-meter")).toContainText("Max level");
  const colors = await first.evaluate((node) =>
    [...node.querySelectorAll(".team-meter")].map((el) =>
      getComputedStyle(el).getPropertyValue("--meter-color").trim(),
    ),
  );
  expect(colors[0]).not.toBe(colors[1]);
});

test("inventory filters all owned copies and click-to-slot saves without altering a duplicate", async ({
  team: { page, p, calls },
}) => {
  await page
    .getByRole("textbox", { name: "Search inventory" })
    .fill("#not-a-match");
  await expect(page.locator(".inventory-tile")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search inventory" }).fill("");
  await expect(page.locator(".inventory-tile")).toHaveCount(24);
  await page.getByRole("button", { name: "Next inventory page" }).click();
  await expect(page.locator(".inventory-tile")).toHaveCount(8);
  await page.getByRole("button", { name: "Previous inventory page" }).click();
  await page.locator('.inventory-tile[data-miscrit-id="5"]').click();
  await page.getByRole("button", { name: /Place .* in slot 2/ }).click();
  await expect(
    page.locator('[data-team-slot="1"] .team-member-select'),
  ).toContainText(catalog.species[0].name);
  expect(p.team_order).toEqual([1, 5, 3, 4]);
  expect(calls.filter(([id]) => id === "update_team")).toHaveLength(1);
});

test("dragging inventory to a slot and dragging active teammates reorders the server team", async ({
  team: { page, p, calls },
}) => {
  async function drag(source, target) {
    await source.hover();
    const from = await source.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      from.x + from.width / 2 + 15,
      from.y + from.height / 2 - 15,
      { steps: 6 },
    );
    await target.scrollIntoViewIfNeeded();
    const to = await target.boundingBox();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
  }
  await drag(
    page.locator('.inventory-tile[data-miscrit-id="5"]'),
    page.locator('[data-team-slot="1"]'),
  );
  await expect.poll(() => p.team_order).toEqual([1, 5, 3, 4]);
  await drag(
    page.locator('[data-team-slot="3"] .team-member-select'),
    page.locator('[data-team-slot="0"]'),
  );
  await expect.poll(() => p.team_order).toEqual([4, 5, 3, 1]);
  expect(calls.filter(([id]) => id === "update_team")).toHaveLength(2);
});

test("stale-team errors refresh the displayed slots without overwriting the new server team", async ({
  team: { page, p, calls },
}) => {
  await page.locator('.inventory-tile[data-miscrit-id="5"]').click();
  p.team_order = [2, 1, 3, 4];
  await page.getByRole("button", { name: /Place .* in slot 2/ }).click();
  await expect(page.locator(".team-error")).toContainText("Your team changed");
  expect(p.team_order).toEqual([2, 1, 3, 4]);
  expect(calls.filter(([id]) => id === "update_team")).toHaveLength(0);
});

test("inventory selection and slot assignment work with the keyboard", async ({
  team: { page, p },
}) => {
  await page.locator('.inventory-tile[data-miscrit-id="5"]').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:/Place .* in slot 1/}).focus();
  await page.keyboard.press('Enter');
  await expect.poll(()=>p.team_order).toEqual([5,2,3,4]);
});

test("mobile team and inventory fit both themes and support tap-to-slot", async ({
  team: { page, p },
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["dark", "light"]) {
    if (theme === "light")
      await page.getByRole("button", { name: "Switch to light mode" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.locator('.inventory-tile[data-miscrit-id="5"]').click();
  await page.getByRole("button", { name: /Place .* in slot 1/ }).click();
  await expect.poll(() => p.team_order).toEqual([5, 2, 3, 4]);
});

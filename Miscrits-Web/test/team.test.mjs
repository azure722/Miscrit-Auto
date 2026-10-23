import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { teamVitals, teamSwap } from "../lib/team.mjs";
import { settings } from "../lib/model.mjs";
import { Engine } from "../lib/engine.mjs";
import { GameError } from "../lib/transport.mjs";
import { createApp } from "../server.mjs";

const protocol = JSON.parse(
  readFileSync(new URL("../data/protocol.json", import.meta.url)),
);
const catalog = {
  teleports: { forest: {} },
  species: [
    {
      id: 1,
      name: "Flue",
      hp: "Elite",
      rarity: "Common",
      element: "Fire",
      stops: [{ location: "forest", area_id: 1, object_id: 0 }],
    },
  ],
};
const raw = (id, level = 1) => ({
  id,
  mId: 1,
  level,
  exp: 0,
  hp: 3,
  chp: 25,
  spd: 3,
  ea: 3,
  pa: 3,
  ed: 3,
  pd: 3,
  bonus_level: level,
  hp_bonus: 2,
});
function harness(config = {}) {
  const p = {
    user_id: "me",
    platinum: 20,
    team_order: [1, 2, 3, 4],
    miscrits: [1, 2, 3, 4, 5].map((id) => raw(id)),
    area: { area_id: 1, location: { name: "forest" } },
    left_traits: [],
    battle: "",
  };
  const calls = [],
    responses = {};
  const engine = new Engine({
    catalog,
    protocol,
    manualTeamManagement: true,
    config: { names: ["Flue"], ...config },
  });
  engine.player = structuredClone(p);
  engine.transport = {
    connected: true,
    close() {},
    async rpc(id, value) {
      calls.push([id, value]);
      if (responses[id]) return responses[id](value);
      if (id === "get_player") return structuredClone(p);
      if (id === "update_team") p.team_order = [...value.team];
      if (id === "xp_train") {
        const m = p.miscrits.find((m) => m.id === value.miscritId);
        m.level++;
        m.exp = 0;
      }
      if (id === "add_bonus") {
        p.miscrits.find((m) => m.id === value.miscritId).bonus_level =
          value.currLevel;
        p.platinum--;
      }
      return {};
    },
  };
  return { engine, p, calls, responses };
}

test("team HP uses native growth, copy color, bonuses and equipped relics in both formats", () => {
  const meta = { hp: "Elite", rarity: "Rare", element: "Fire" };
  assert.equal(teamVitals({ ...raw(1, 10), hp_bonus: 4 }, meta).hp, 67);
  assert.equal(
    teamVitals(
      { v: 2, l: 10, h: 3, hb: 4, bl: 9, r1: { effect: { hp: 7 } } },
      meta,
    ).hp,
    74,
  );
  assert.equal(teamVitals({ ...raw(1), stats: { hp: 130 } }, meta).hp, 130);
  assert.equal(
    teamVitals({ ...raw(1), relic1: 77 }, meta).hp,
    null,
    "unknown relic stats are never guessed",
  );
  assert.equal(teamVitals(raw(1), {}).hp, null);
  assert.equal(teamVitals({ v: 2, bl: 12 }, meta).bonusLevel, 12);
});

test("swap planning replaces copies, reorders existing teammates and rejects holes or unknown IDs", () => {
  const roster = [1, 2, 3, 4, 5].map(raw);
  assert.deepEqual(teamSwap([1, 2, 3, 4], roster, 5, 0), [5, 2, 3, 4]);
  assert.deepEqual(teamSwap([1, 2, 3, 4], roster, 3, 0), [3, 2, 1, 4]);
  assert.deepEqual(teamSwap([1, 2], roster, 5, 2), [1, 2, 5]);
  for (const [team, id, slot] of [
    [[1, 2], 5, 3],
    [[1, 2], 1, 2],
    [[1, 1], 5, 1],
    [[1, 9], 5, 1],
    [[1, 2], 9, 1],
    [[1, 2], 5, -1],
  ])
    assert.throws(() => teamSwap(team, roster, id, slot));
});

test("website mode retires old training and replacements on startup and on saved profiles", () => {
  const { engine } = harness({
    trainSelected: true,
    autoReplace: true,
    replacementNames: ["Flue"],
  });
  assert.equal(engine.config.trainSelected, false);
  assert.equal(engine.config.autoReplace, false);
  assert.deepEqual(engine.config.replacementNames, []);
  engine.updateConfig({
    ...engine.config,
    trainSelected: true,
    autoReplace: true,
    replacementNames: ["Flue"],
  });
  assert.equal(engine.config.trainSelected, false);
  assert.equal(engine.config.autoReplace, false);
});

test("training settings validate individual copy permissions and retain unrelated capture preferences", () => {
  assert.deepEqual(settings({}, catalog).platinumUpgradeIds, []);
  assert.deepEqual(
    settings({ platinumUpgradeIds: [1, 1, 2] }, catalog).platinumUpgradeIds,
    [1, 2],
  );
  for (const value of [true, ["1"], [-1], [NaN]])
    assert.throws(() => settings({ platinumUpgradeIds: value }, catalog));
  const { engine } = harness({ captureThreshold: 81 });
  engine.updateTeamSettings({ autoLevel: true, platinumUpgradeIds: [2] });
  assert.equal(engine.config.autoLevel, true);
  assert.equal(engine.config.captureThreshold, 81);
  assert.deepEqual(engine.config.platinumUpgradeIds, [2]);
  assert.throws(
    () =>
      engine.updateTeamSettings({ autoLevel: true, platinumUpgradeIds: [999] }),
    /owned/,
  );
});

test("team save sends one native request then verifies authoritative team order", async () => {
  const { engine, calls } = harness();
  await engine.swapTeam({ miscritId: 5, slot: 1, expectedTeam: [1, 2, 3, 4] });
  assert.deepEqual(
    calls.map(([id]) => id),
    ["get_player", "update_team", "get_player"],
  );
  assert.deepEqual(calls[1][1], { team: [1, 5, 3, 4] });
  assert.deepEqual(
    engine.snapshot().player.team.map((m) => m.id),
    [1, 5, 3, 4],
  );
  assert.equal(engine.busy, false);
});

test("swaps block running, battles, draft, queue, uncertainty and concurrent saves", async () => {
  for (const flag of [
    "running",
    "busy",
    "reconnecting",
    "battle",
    "draft",
    "uncertain",
    "arenaQueue",
  ]) {
    const { engine, calls } = harness();
    engine[flag] = flag === "arenaQueue" ? { ticket: "queue" } : true;
    await assert.rejects(() =>
      engine.swapTeam({ miscritId: 5, slot: 1, expectedTeam: [1, 2, 3, 4] }),
    );
    assert.equal(calls.length, 0);
  }
  const { engine, calls, responses, p } = harness();
  let release;
  responses.update_team = (value) =>
    new Promise((resolve) => {
      release = () => {
        p.team_order = value.team;
        resolve({});
      };
    });
  const pending = engine.swapTeam({
    miscritId: 5,
    slot: 1,
    expectedTeam: [1, 2, 3, 4],
  });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() =>
    engine.swapTeam({ miscritId: 5, slot: 1, expectedTeam: [1, 2, 3, 4] }),
  );
  release();
  await pending;
  assert.equal(calls.filter(([id]) => id === "update_team").length, 1);
});

test("stale team, fresh battle, rejected and uncertain saves cannot duplicate a mutation", async () => {
  for (const outcome of [
    "stale",
    "battle",
    "rejected",
    "unconfirmed",
    "refresh-failed",
  ]) {
    const { engine, p, calls, responses } = harness();
    if (outcome === "stale") p.team_order = [2, 1, 3, 4];
    if (outcome === "battle") p.battle = "fresh";
    if (outcome === "rejected")
      responses.update_team = () => {
        throw new GameError("rejected");
      };
    if (outcome === "unconfirmed") responses.update_team = () => ({});
    if (outcome === "refresh-failed") {
      let reads = 0;
      responses.get_player = () => {
        if (reads++) throw new Error("offline");
        return structuredClone(p);
      };
    }
    await assert.rejects(() =>
      engine.swapTeam({ miscritId: 5, slot: 1, expectedTeam: [1, 2, 3, 4] }),
    );
    assert.equal(
      calls.filter(([id]) => id === "update_team").length,
      ["stale", "battle"].includes(outcome) ? 0 : 1,
    );
    assert.equal(
      engine.uncertain,
      ["unconfirmed", "refresh-failed"].includes(outcome),
    );
    assert.equal(engine.busy, false);
  }
});

test("bonus upgrades require XP training, master enabled, exact copy permission and one platinum", async () => {
  for (const selected of [false, true]) {
    const { engine, p, calls } = harness({
      autoLevel: true,
      platinumUpgradeIds: selected ? [2] : [],
    });
    p.miscrits[1].exp = 10;
    engine.running = true;
    await engine.tick();
    assert.deepEqual(
      calls
        .filter(([id]) => ["xp_train", "add_bonus"].includes(id))
        .map(([id]) => id),
      selected ? ["xp_train", "add_bonus"] : ["xp_train"],
    );
    assert.equal(p.platinum, selected ? 19 : 20);
    if (selected)
      assert.deepEqual(calls.find(([id]) => id === "add_bonus")[1], {
        miscritId: 2,
        currLevel: 2,
      });
  }
  const { engine, calls } = harness({
    autoLevel: false,
    platinumUpgradeIds: [2],
  });
  engine.running = true;
  await engine.upgradeTrainingBonus(2);
  assert.equal(calls.length, 0);
});

test("bonus purchase rechecks pause and never catches up, retries, or spends on another copy", async () => {
  for (const outcome of [
    "pause",
    "insufficient",
    "catchup",
    "rejected",
    "unconfirmed",
  ]) {
    const { engine, p, calls, responses } = harness({
      autoLevel: true,
      platinumUpgradeIds: [2],
    });
    p.miscrits[1].exp = 10;
    engine.running = true;
    if (outcome === "pause")
      responses.xp_train = () => {
        p.miscrits[1].level++;
        p.miscrits[1].exp = 0;
        engine.stop();
        return {};
      };
    if (outcome === "insufficient") p.platinum = 0;
    if (outcome === "catchup") p.miscrits[1].bonus_level = 0;
    if (outcome === "rejected")
      responses.add_bonus = () => {
        throw new GameError("bonus rejected");
      };
    if (outcome === "unconfirmed") responses.add_bonus = () => ({});
    await engine.tick();
    await engine.tick();
    assert.equal(
      calls.filter(([id]) => id === "add_bonus").length,
      ["rejected", "unconfirmed"].includes(outcome) ? 1 : 0,
    );
    assert.equal(engine.running, false);
    assert.equal(engine.uncertain, outcome === "unconfirmed");
  }
});

test("team HTTP endpoints retain owner, CSRF and foreign-origin checks", async () => {
  const { engine } = harness(),
    app = await createApp({ port: 0, fetchData: false, engine });
  const url = "http://127.0.0.1:" + app.server.address().port;
  try {
    const boot = await fetch(url + "/api/bootstrap"),
      cookie = boot.headers.get("set-cookie").split(";")[0],
      { csrf } = await boot.json();
    const headers = {
      Cookie: cookie,
      "X-Miscrits-CSRF": csrf,
      "Content-Type": "application/json",
    };
    const swap = { miscritId: 5, slot: 1, expectedTeam: [1, 2, 3, 4] };
    assert.equal(
      (
        await fetch(url + "/api/team/swap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(swap),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/api/team/swap", {
          method: "POST",
          headers: { ...headers, Origin: "https://foreign.example" },
          body: JSON.stringify(swap),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/api/team/swap", {
          method: "POST",
          headers,
          body: JSON.stringify(swap),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(url + "/api/team/settings", {
          method: "POST",
          headers,
          body: JSON.stringify({ autoLevel: true, platinumUpgradeIds: [5] }),
        })
      ).status,
      200,
    );
  } finally {
    await app.close();
  }
});

// Native PlayerMiscrit.set_stats: HP growth, copy color, bonus, equipped relics.
const STARS = { Weak: 1, Moderate: 2, Strong: 3, Max: 4, Elite: 5 };
export function teamVitals(raw, metadata) {
  const compact = raw.v === 2,
    level = compact ? raw.l : raw.level,
    color = compact ? raw.h : raw.hp;
  const bonus = compact ? raw.hb : raw.hp_bonus,
    bonusLevel = compact ? raw.bl : raw.bonus_level;
  let hp = Number.isFinite(raw.stats?.hp) ? raw.stats.hp : null;
  if (
    hp === null &&
    STARS[metadata?.hp] &&
    Number.isInteger(level) &&
    Number.isInteger(color)
  ) {
    hp =
      Math.trunc(
        (level * (12 + STARS[metadata.hp] * 2 + color * 1.5)) / 5 + 10,
      ) + (Number.isFinite(bonus) ? bonus : 0);
    for (let slot = 1; slot <= 4; slot++) {
      const relic = raw[(compact ? "r" : "relic") + slot];
      if (!relic) continue;
      if (!relic.effect || typeof relic.effect !== "object") {
        hp = null;
        break;
      }
      if (relic.effect.hp !== undefined) {
        const extra = Number(relic.effect.hp);
        if (!Number.isFinite(extra)) {
          hp = null;
          break;
        }
        hp += Math.trunc(extra);
      }
    }
  }
  return {
    hp: Number.isFinite(hp) && hp > 0 ? hp : null,
    bonusLevel:
      Number.isInteger(bonusLevel) && bonusLevel >= 0 ? bonusLevel : null,
    rarity: metadata?.rarity || "Unknown",
    element: metadata?.element || "Unknown",
  };
}

export function teamSwap(team, roster, miscritId, slot) {
  if (
    !Array.isArray(team) ||
    !Array.isArray(roster) ||
    team.length > 4 ||
    new Set(team).size !== team.length ||
    team.some(
      (id) => !Number.isSafeInteger(id) || !roster.some((m) => m.id === id),
    )
  )
    throw new Error("The active team is invalid. Reconnect before swapping.");
  if (
    !Number.isSafeInteger(miscritId) ||
    !roster.some((m) => m.id === miscritId)
  )
    throw new Error("Choose an owned Miscrit.");
  if (!Number.isInteger(slot) || slot < 0 || slot > 3 || slot > team.length)
    throw new Error("Choose the next empty slot or an occupied slot.");
  const next = [...team],
    previous = next.indexOf(miscritId);
  if (previous === slot) return next;
  if (previous >= 0) {
    if (slot === next.length)
      throw new Error(
        "Drop an active teammate onto an occupied slot to reorder.",
      );
    [next[previous], next[slot]] = [next[slot], next[previous]];
  } else next[slot] = miscritId;
  return next;
}

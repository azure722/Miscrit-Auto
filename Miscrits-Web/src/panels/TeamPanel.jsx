import { useState, useRef, useSyncExternalStore } from "react";
import {
  FiSearch,
  FiUsers,
  FiMove,
  FiZap,
  FiHeart,
  FiAward,
  FiArrowLeft,
  FiArrowRight,
  FiX,
} from "react-icons/fi";
import { teamStore } from "../team-store.js";

const RARITIES = ["All", "Common", "Rare", "Epic", "Exotic", "Legendary"];
function Portrait({ member, catalog }) {
  const family =
    catalog.find((entry) => entry.id === member.mId)?.name || member.name;
  const src =
    "https://cdn.worldofmiscrits.com/avatars/" +
    family.toLowerCase().replaceAll(" ", "_") +
    "_avatar.png";
  return (
    <img
      className="avatar"
      src={src}
      alt=""
      draggable={false}
      loading="lazy"
      onError={(event) => {
        if (!event.currentTarget.src.endsWith("/mark.svg"))
          event.currentTarget.src = "/mark.svg";
      }}
    />
  );
}
function Meter({ member, type }) {
  const health = type === "hp",
    max = health ? member.hp : member.xpNeeded,
    current = health ? member.chp : member.xp;
  const complete = !health && member.level >= 35,
    known = Number.isFinite(max) && max > 0 && Number.isFinite(current);
  const text = health
    ? known
      ? `${Math.max(0, current)} / ${max}`
      : `${Number.isFinite(current) ? Math.max(0, current) : "—"} / —`
    : complete
      ? "Max level"
      : known
        ? `${current} / ${max}`
        : "Unavailable";
  return (
    <div
      className={`team-meter ${health ? "health-meter" : "experience-meter"}`}
    >
      <div className="meter-caption">
        <span>
          {health ? (
            <FiHeart aria-hidden="true" />
          ) : (
            <FiZap aria-hidden="true" />
          )}
          {health ? "HP" : "XP"}
        </span>
        <strong>
          {health && current <= 0 ? "Fainted · " : ""}
          {text}
        </strong>
      </div>
      <progress
        aria-label={`${member.name} ${health ? "HP" : "XP"}`}
        aria-valuetext={text}
        max={known ? max : 1}
        value={complete ? 1 : known ? Math.max(0, Math.min(current, max)) : 0}
      />
      {!health && member.readyToTrain && <small>Ready to level up</small>}
    </div>
  );
}

export default function TeamPanel() {
  const { state, catalog, pending, error, message } = useSyncExternalStore(
    teamStore.subscribe,
    teamStore.getSnapshot,
  );
  const [query, setQuery] = useState(""),
    [rarity, setRarity] = useState("All"),
    [sort, setSort] = useState("level"),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null),
    [dropSlot, setDropSlot] = useState(null);
  const dragRef = useRef(null),
    [trainingIntent, setTrainingIntent] = useState(null);
  const player = state?.player,
    team = player?.team || [],
    roster = player?.roster || [],
    config = { ...state?.config, ...trainingIntent };
  const ready = Boolean(
      state?.connected && !state.reconnecting && !state.requiresLogin,
    ),
    supported = state?.teamManagementVersion === 1;
  const inBattle = Boolean(state?.battle || state?.draft),
    queued = Boolean(state?.arena?.queue?.searching);
  const locked =
    pending ||
    !ready ||
    !supported ||
    state?.running ||
    state?.busy ||
    inBattle ||
    queued ||
    state?.uncertain;
  const reason = !player
    ? "Sign in to view your inventory."
    : !supported
      ? "Finish your battle, stop the website backend, then launch it again to enable team management."
      : state?.running
        ? "Pause automation to change your team or training settings."
        : inBattle || queued
          ? "Finish the battle or leave the arena queue to change your team."
          : state?.reconnecting
            ? "Reconnecting to your account…"
            : state?.uncertain
              ? "Reconnect and check your team before making another change."
              : pending
                ? "Saving your change…"
                : "Drag a Miscrit onto a team slot, or select one and choose a slot.";
  const active = new Set(team.map((member) => member.id));
  const details = (member) => {
    const family = catalog.find((entry) => entry.id === member.mId);
    return {
      ...member,
      rarity: member.rarity || family?.rarity || "Unknown",
      family: family?.name || member.name,
    };
  };
  const filtered = roster
    .map(details)
    .filter(
      (member) =>
        (rarity === "All" || member.rarity === rarity) &&
        `${member.name} ${member.family} ${member.id}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "rating"
        ? b.rating - a.rating || b.level - a.level || a.id - b.id
        : sort === "name"
          ? a.name.localeCompare(b.name) || a.id - b.id
          : b.level - a.level || b.rating - a.rating || a.id - b.id,
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 24)),
    currentPage = Math.min(page, pages),
    selectedMember = roster.find((member) => member.id === selected);
  function startDrag(event, id) {
    if (locked) {
      event.preventDefault();
      return;
    }
    dragRef.current = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-miscrits-id", String(id));
  }
  function clearDrag() {
    dragRef.current = null;
    setDropSlot(null);
  }
  async function swap(id, slot) {
    clearDrag();
    if (locked || !Number.isSafeInteger(id)) return;
    const ok = await teamStore.request("swap", {
      miscritId: id,
      slot,
      expectedTeam: team.map((member) => member.id),
    });
    if (ok) setSelected(null);
  }
  function drop(event, slot) {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData("application/x-miscrits-id"));
    if (dragRef.current === id) void swap(id, slot);
    else clearDrag();
  }
  async function saveTraining(
    autoLevel,
    ids = config.platinumUpgradeIds || [],
  ) {
    const value = { autoLevel, platinumUpgradeIds: ids };
    setTrainingIntent(value);
    try {
      return await teamStore.request("settings", value);
    } finally {
      setTrainingIntent(null);
    }
  }
  function toggleBonus(id) {
    const ids = config.platinumUpgradeIds || [];
    void saveTraining(
      Boolean(config.autoLevel),
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  }
  function choose(id) {
    if (!locked) setSelected(selected === id ? null : id);
  }
  function chooseKey(event, id) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(id);
    }
  }
  return (
    <section id="tab-team" className="tab-panel team-workspace" hidden>
      <article className="card active-team-card">
        <div className="card-heading team-section-heading">
          <div>
            <span className="eyebrow">TEAM MANAGEMENT</span>
            <h2>
              Your active team <span className="muted">{team.length} / 4</span>
            </h2>
          </div>
          <label className="team-auto-toggle">
            <FiZap aria-hidden="true" />
            <span>Auto level-up</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Auto level-up"
              checked={Boolean(config.autoLevel)}
              disabled={locked}
              onChange={(event) => void saveTraining(event.target.checked)}
            />
            <span className="toggle-state">
              {config.autoLevel ? "On" : "Off"}
            </span>
          </label>
        </div>
        <p className="team-subtitle">
          Levels your active team with earned XP, up to level 35.
        </p>
        <div className="active-team-grid">
          {Array.from({ length: 4 }, (_, slot) => {
            const member = team[slot],
              canPlace =
                selectedMember &&
                !locked &&
                slot <= team.length &&
                member?.id !== selected &&
                !(active.has(selected) && slot === team.length);
            const checked = Boolean(
              member && (config.platinumUpgradeIds || []).includes(member.id),
            );
            return (
              <article
                key={slot}
                className={`team-slot${dropSlot === slot ? " drop-target" : ""}${selected === member?.id ? " selected-slot" : ""}`}
                data-team-slot={slot}
                onDragOver={(event) => {
                  if (
                    !locked &&
                    dragRef.current !== null &&
                    slot <= team.length
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropSlot(slot);
                  }
                }}
                onDragLeave={() => setDropSlot(null)}
                onDrop={(event) => drop(event, slot)}
              >
                <div className="team-slot-heading">
                  <span>
                    Slot {slot + 1}
                    {slot === 0 ? " · Lead" : ""}
                  </span>
                  <FiMove aria-hidden="true" />
                </div>
                {member ? (
                  <>
                    <div
                      className="team-member-select"
                      role="button"
                      tabIndex={locked ? -1 : 0}
                      draggable={!locked}
                      onDragStart={(event) => startDrag(event, member.id)}
                      onDragEnd={clearDrag}
                      aria-disabled={Boolean(locked)}
                      aria-label={`Select ${member.name} in slot ${slot + 1} to move`}
                      aria-pressed={selected === member.id}
                      onClick={() => choose(member.id)}
                      onKeyDown={(event) => chooseKey(event, member.id)}
                    >
                      <Portrait member={member} catalog={catalog} />
                      <strong>{member.name}</strong>
                      <span>
                        Level {member.level} <span aria-hidden="true">·</span>{" "}
                        {member.rating}/18
                      </span>
                    </div>
                    <Meter member={member} type="hp" />
                    <Meter member={member} type="xp" />
                    <label
                      className={`platinum-toggle${!config.autoLevel ? " is-unavailable" : ""}`}
                    >
                      <FiAward aria-hidden="true" />
                      <span>Platinum upgrade</span>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`Platinum upgrade for ${member.name} #${member.id}`}
                        checked={checked}
                        disabled={locked || !config.autoLevel}
                        onChange={() => toggleBonus(member.id)}
                      />
                    </label>
                    <small className="platinum-cost">
                      1 platinum per new level
                    </small>
                  </>
                ) : (
                  <div className="team-empty-slot">
                    <FiUsers aria-hidden="true" />
                    <strong>Empty slot</strong>
                    <span>Drop a Miscrit here</span>
                  </div>
                )}
                {selectedMember && (
                  <button
                    className="button small slot-place"
                    type="button"
                    disabled={!canPlace}
                    onClick={() => void swap(selected, slot)}
                    aria-label={`Place ${selectedMember.name} in slot ${slot + 1}`}
                  >
                    {member?.id === selected
                      ? "Selected"
                      : `Place in slot ${slot + 1}`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
        <p className="team-edit-status" role="status">
          {reason}
        </p>
        {config.autoLevel && (
          <p className="team-bonus-note">
            Platinum upgrades are optional bonus stats after a new level. Each
            switch applies to that individual Miscrit. Catch-up bonus purchases
            are paused for review.
          </p>
        )}
        {error && (
          <p className="team-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="team-success" role="status">
            {message}
          </p>
        )}
      </article>
      <article className="card inventory-card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">YOUR MISCRITS</span>
            <h2>Inventory</h2>
          </div>
          <span className="badge">{roster.length} owned</span>
        </div>
        <div className="inventory-toolbar">
          <div className="search-form">
            <FiSearch aria-hidden="true" />
            <input
              aria-label="Search inventory"
              placeholder="Search by name or copy ID…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <label className="inventory-sort">
            Sort by
            <select
              aria-label="Sort inventory"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              <option value="level">Level</option>
              <option value="rating">Rating</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        <div
          className="hunt-rarities"
          role="group"
          aria-label="Inventory rarity"
        >
          {RARITIES.map((value) => (
            <button
              key={value}
              className={`hunt-rarity${value === rarity ? " is-active" : ""}`}
              type="button"
              aria-pressed={value === rarity}
              onClick={() => {
                setRarity(value);
                setPage(1);
              }}
            >
              {value}
            </button>
          ))}
        </div>
        {selectedMember && (
          <div className="inventory-selection" role="status">
            <span>
              <strong>{selectedMember.name}</strong> selected. Choose a team
              slot above.
            </span>
            <button
              className="button small subtle"
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Clear selected Miscrit"
            >
              <FiX aria-hidden="true" />
            </button>
          </div>
        )}
        {!player ? (
          <div className="inventory-empty">
            <FiUsers aria-hidden="true" />
            <h3>Your inventory will appear here</h3>
            <p>Sign in to load your owned Miscrits and build your team.</p>
          </div>
        ) : !filtered.length ? (
          <p className="inventory-empty">No Miscrits match your filters.</p>
        ) : (
          <div className="inventory-grid" aria-label="Owned Miscrits">
            {filtered
              .slice((currentPage - 1) * 24, currentPage * 24)
              .map((member) => (
                <div
                  key={member.id}
                  data-miscrit-id={member.id}
                  role="button"
                  tabIndex={locked ? -1 : 0}
                  className={`inventory-tile${selected === member.id ? " is-selected" : ""}${active.has(member.id) ? " in-team" : ""}`}
                  draggable={!locked}
                  onDragStart={(event) => startDrag(event, member.id)}
                  onDragEnd={clearDrag}
                  aria-disabled={Boolean(locked)}
                  onClick={() => choose(member.id)}
                  onKeyDown={(event) => chooseKey(event, member.id)}
                  aria-label={`Select ${member.name}, level ${member.level}, rating ${member.rating} out of 18, copy ${member.id}${active.has(member.id) ? ", in active team" : ""}`}
                  aria-pressed={selected === member.id}
                >
                  <div className="inventory-tile-top">
                    <span className="inventory-rarity">{member.rarity}</span>
                    {active.has(member.id) ? (
                      <span className="inventory-active-badge">
                        Slot{" "}
                        {team.findIndex((value) => value.id === member.id) + 1}
                      </span>
                    ) : (
                      <FiMove aria-hidden="true" />
                    )}
                  </div>
                  <Portrait member={member} catalog={catalog} />
                  <strong>{member.name}</strong>
                  <span className="inventory-meta">
                    Lv. {member.level} <span aria-hidden="true">·</span>{" "}
                    {member.rating}/18
                  </span>
                  <span className="inventory-copy">
                    {member.element && member.element !== "Unknown"
                      ? member.element + " · "
                      : ""}
                    #{member.id}
                  </span>
                  <Meter member={member} type="hp" />
                  <Meter member={member} type="xp" />
                </div>
              ))}
          </div>
        )}
        <div className="hunt-pagination inventory-pagination">
          <button
            className="button small subtle"
            type="button"
            aria-label="Previous inventory page"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <FiArrowLeft aria-hidden="true" />
          </button>
          <span role="status">
            {filtered.length} Miscrits · {currentPage} / {pages}
          </span>
          <button
            className="button small subtle"
            type="button"
            aria-label="Next inventory page"
            disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            <FiArrowRight aria-hidden="true" />
          </button>
        </div>
      </article>
    </section>
  );
}

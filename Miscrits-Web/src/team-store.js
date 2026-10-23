// Reactive bridge for the existing local browser-session API.
let snapshot = {
  state: null,
  catalog: [],
  pending: false,
  error: "",
  message: "",
};
let commands = null;
const listeners = new Set();
function update(value) {
  snapshot = { ...snapshot, ...value };
  for (const listener of listeners) listener();
}
export const teamStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return snapshot;
  },
  publish(state, catalog) {
    update({ state, catalog });
  },
  connect(value) {
    commands = value;
    return () => {
      commands = null;
    };
  },
  async request(kind, value) {
    if (snapshot.pending || !commands) return false;
    update({ pending: true, error: "", message: "" });
    try {
      await commands[kind](value);
      update({
        message:
          kind === "swap" ? "Active team saved." : "Training settings saved.",
      });
      return true;
    } catch (error) {
      update({ error: error.message || "The team change could not be saved." });
      return false;
    } finally {
      update({ pending: false });
    }
  },
};

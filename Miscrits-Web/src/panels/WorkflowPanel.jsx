// Static controls are wired by the existing automation controller.
export default function WorkflowPanel() {
  return (
    <section id="tab-workflow" className="tab-panel" hidden>
      <article className="card stop-report">
        <div className="card-heading">
          <div>
            <span className="eyebrow">WHEN A RUN PAUSES</span>
            <h2>Why automation stopped</h2>
          </div>
          <span id="stop-report-state" className="badge">
            No stops recorded
          </span>
        </div>
        <p id="stop-report-empty" className="hint">
          The next stop will show its reason, search context and suggested next
          step here.
        </p>
        <div id="stop-report-details" hidden>
          <h3 id="stop-report-category"></h3>
          <p id="stop-report-reason"></p>
          <small id="stop-report-context" className="muted"></small>
          <div className="stop-next">
            <span className="eyebrow">SUGGESTED NEXT STEP</span>
            <p id="stop-report-action"></p>
          </div>
        </div>
        <p className="fine-print">
          Keeps the latest stop for this sign-in session, even after status
          updates or resuming. Suggestions do not perform game actions.
        </p>
      </article>
      <article className="card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">THE NEXT STEP</span>
            <h2>Live target queue</h2>
          </div>
          <span id="queue-running" className="badge">
            Paused
          </span>
        </div>
        <p id="queue-message" className="hint"></p>
        <div className="workflow-now">
          <div>
            <span className="eyebrow">CURRENT / LAST SEARCH</span>
            <p id="queue-current">No search yet</p>
          </div>
          <div>
            <span className="eyebrow">NEXT AVAILABLE OBJECT</span>
            <p id="queue-next">No object available</p>
          </div>
        </div>
        <div id="queue-list" className="workflow-list"></div>
        <p className="fine-print">
          Uses saved settings, map access, today's schedules and object
          cooldowns. Unavailable species show the reason. Encounters remain
          random.
        </p>
      </article>
      <div className="two-columns team-bottom">
        <article className="card">
          <span className="eyebrow">BETWEEN WILD ENCOUNTERS</span>
          <h2>Wild-hunt healing</h2>
          <label className="switch-row">
            <div>
              <strong>Heal when a teammate faints</strong>
              <small>
                Normal heal costs 10 virtue. Stops at your session limit or if
                healing is unavailable.
              </small>
            </div>
            <input id="wild-heal" type="checkbox" role="switch" />
          </label>
          <label htmlFor="wild-heal-budget">
            Virtue budget per sign-in session
          </label>
          <input
            id="wild-heal-budget"
            type="number"
            min="0"
            max="1000"
            step="10"
            defaultValue="30"
          />
          <p id="wild-heal-usage" className="hint">
            0 virtue used
          </p>
          <button className="button save full">Save healing settings</button>
          <p className="fine-print">
            Counter reset and profile changes do not reset budget usage. A fresh
            sign-in starts a new budget. Campaign keeps its existing two-fainted
            rule. No platinum heal.
          </p>
        </article>
        <article className="card">
          <span className="eyebrow">REUSABLE SETUPS</span>
          <h2>Hunt profiles</h2>
          <label htmlFor="profile-name">Profile name</label>
          <input
            id="profile-name"
            maxLength="48"
            placeholder="Example: Exotic 17+ training"
          />
          <button id="profile-save" className="button full" type="button">
            Save current form as profile
          </button>
          <label htmlFor="profile-list">Saved profiles</label>
          <select id="profile-list">
            <option value="">Choose a profile</option>
          </select>
          <div className="workflow-buttons">
            <button id="profile-load" className="button" type="button">
              Load profile
            </button>
            <button id="profile-delete" className="button subtle" type="button">
              Delete profile
            </button>
          </div>
          <p className="fine-print">
            Profiles store hunt, team and healing preferences only. Loading
            saves those settings and requires automation paused. It never starts
            a run. Up to 20 profiles; saving an existing name replaces it.
          </p>
        </article>
      </div>
      <article className="card team-bottom">
        <div className="card-heading">
          <div>
            <span className="eyebrow">THIS SIGN-IN SESSION</span>
            <h2>Session statistics</h2>
          </div>
          <button
            id="stats-reset"
            className="button small subtle"
            type="button"
          >
            Reset counters
          </button>
        </div>
        <div id="session-stats" className="workflow-stats"></div>
        <p className="fine-print">
          Searches count submitted search requests. Captures count confirmed
          keeps; duplicates mean an already-owned family. XP is the
          server-awarded team XP in battle summaries. Elapsed time includes
          pauses. Stats reset on sign-in/backend restart; healing budget usage
          does not reset with these counters.
        </p>
      </article>
      <article className="card team-bottom">
        <div className="card-heading">
          <div>
            <span className="eyebrow">STAY INFORMED</span>
            <h2>Notifications</h2>
          </div>
          <button
            id="desktop-notifications"
            className="button small"
            type="button"
          >
            Enable browser alerts
          </button>
        </div>
        <label className="switch-row">
          <div>
            <strong>Capture, training and stopped alerts</strong>
            <small>
              17+ kept captures, completed training, disconnections and
              automation stops.
            </small>
          </div>
          <input
            id="notify-events"
            type="checkbox"
            role="switch"
            defaultChecked
          />
        </label>
        <p id="notifications-help" className="hint">
          In-app alerts are collected by the backend. Browser alerts require
          permission and this page open.
        </p>
        <button className="button save small">
          Save notification settings
        </button>
        <div id="workflow-alerts" className="workflow-list"></div>
      </article>
    </section>
  );
}

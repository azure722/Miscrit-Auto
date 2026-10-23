// Static controls are wired by the existing automation controller.
export default function ArenaPanel() {
  return (
    <section id="tab-arena" className="tab-panel" hidden>
      <article className="card arena-account">
        <div className="card-heading">
          <div>
            <span className="eyebrow">YOUR ACCOUNT RECORD</span>
            <h2 id="arena-record-title">Arena win totals</h2>
          </div>
          <button
            id="arena-refresh-totals"
            className="button small subtle"
            type="button"
          >
            Refresh totals
          </button>
        </div>
        <div
          id="arena-account-totals"
          className="workflow-stats arena-record-stats"
        ></div>
        <p id="arena-record-source" className="hint">
          Sign in to load your current arena record.
        </p>
        <p className="fine-print">
          Account totals come from the game server and remain separate from this
          run. Battle Arena shows weekly wins; Random Arena shows monthly wins.
          Platinum shows lifetime wins only when supplied by the server, plus
          current/best streak.
        </p>
      </article>
      <div className="two-columns">
        <article className="card">
          <span className="eyebrow">FIND YOUR OPPONENT</span>
          <h2>Auto arena battle</h2>
          <label htmlFor="arena-type">Arena mode</label>
          <select id="arena-type">
            <option value="Default">Battle Arena</option>
            <option value="Platinum">Platinum Arena</option>
            <option value="Random">Random Arena</option>
          </select>
          <p className="hint" id="arena-rules"></p>
          <label htmlFor="arena-strategy">Battle strategy</label>
          <select id="arena-strategy">
            <option value="smart">Smart: matchup and survival</option>
            <option value="basic">Basic: highest attack power</option>
          </select>
          <label htmlFor="arena-limit">Maximum completed battles per run</label>
          <input
            id="arena-limit"
            type="number"
            min="1"
            max="1000"
            step="1"
            defaultValue="10"
          />
          <label className="switch-row">
            <div>
              <strong>Stop after a defeat</strong>
              <small>
                Pause after the first loss so you can review your team.
              </small>
            </div>
            <input
              id="arena-stop-loss"
              type="checkbox"
              role="switch"
              defaultChecked
            />
          </label>
          <label className="switch-row">
            <div>
              <strong>Allow fainted teammates in Platinum</strong>
              <small>
                Uses the current HP supplied by the arena. At least one teammate
                must still be alive.
              </small>
            </div>
            <input id="arena-injured" type="checkbox" role="switch" />
          </label>
          <button className="button save full">Save arena settings</button>
          <p className="fine-print">
            Save, then press Start automation while on this tab. Uses your
            current team and HP. Team training/replacement and wild healing are
            suspended during arena runs. No automatic platinum heal or item
            purchases. Opponents and outcomes follow the game server.
          </p>
        </article>
        <article className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">CURRENT RUN</span>
              <h2>Arena status</h2>
            </div>
            <span id="arena-status" className="badge">
              Idle
            </span>
          </div>
          <p id="arena-queue" className="hint">
            Choose an arena and sign in to start.
          </p>
          <div id="arena-counters" className="workflow-stats arena-stats"></div>
          <p id="arena-decision" className="hint"></p>
          <button
            className="button full subtle"
            id="arena-open-battle"
            type="button"
          >
            Open Live battle
          </button>
          <p className="fine-print">
            Pause cancels an outstanding queue. If a match was already assigned,
            it is restored for manual play. Default/Platinum follow the native
            91-second bot fallback; matchmaking stops after 120 seconds. Random
            Arena first bans 6 species, then picks 4 from the server pool.
          </p>
        </article>
      </div>
      <article id="arena-draft" className="card team-bottom" hidden>
        <div className="card-heading">
          <div>
            <span className="eyebrow">RANDOM ARENA</span>
            <h2 id="draft-title">Draft</h2>
          </div>
          <span id="draft-time" className="badge"></span>
        </div>
        <p id="draft-help" className="hint"></p>
        <div id="draft-pool" className="arena-pool"></div>
        <button
          id="draft-submit"
          className="button full"
          type="button"
          disabled
        >
          Submit selection
        </button>
        <p className="fine-print">
          While running, automation ranks abilities and stat profiles; picks
          also balance element coverage. Pause to choose manually; the server
          timer keeps running. This is a basic strategy and does not guarantee a
          win.
        </p>
      </article>
    </section>
  );
}

// Static controls are wired by the existing automation controller.
import {
  FiSearch,
  FiSettings,
  FiArrowLeft,
  FiArrowRight,
} from "react-icons/fi";
export default function HuntPanel() {
  return (
    <section id="tab-hunt" className="tab-panel">
      <p className="hunt-guide">
        1. Pick Miscrits <span aria-hidden="true">&#8594;</span> 2. Set capture
        rules <span aria-hidden="true">&#8594;</span> 3. Save &amp; start
      </p>
      <div className="two-columns hunt-layout">
        <article className="card targets-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">1 &middot; CHOOSE YOUR TARGETS</span>
              <h2>Find a Miscrit</h2>
            </div>
            <span id="target-count" className="badge">
              0 targets
            </span>
          </div>
          <p className="muted">
            Click a portrait to add it. Only maps unlocked on your account can
            be hunted.
          </p>
          <form id="target-form" className="search-form">
            <label className="sr-only" htmlFor="target-input">
              Search Miscrits
            </label>
            <FiSearch aria-hidden="true" />
            <input
              id="target-input"
              placeholder="Search Miscrits..."
              autoComplete="off"
            />
            <button className="button small" type="submit">
              Add +
            </button>
          </form>
          <datalist id="species"></datalist>
          <div
            id="hunt-rarities"
            className="hunt-rarities"
            role="group"
            aria-label="Filter by rarity"
          ></div>
          <div className="hunt-browser-tools">
            <label className="hunt-available">
              <input id="hunt-available" type="checkbox" /> Available only
            </label>
            <button
              id="hunt-add-visible"
              className="button small subtle"
              type="button"
            >
              Add available
            </button>
          </div>
          <p id="hunt-access" className="hint" role="status">
            Sign in to check your unlocked maps.
          </p>
          <div
            id="hunt-grid"
            className="hunt-grid"
            aria-label="Miscrit catalog"
          ></div>
          <div className="hunt-pagination">
            <button
              id="hunt-prev"
              className="button small subtle"
              type="button"
              aria-label="Previous Miscrits"
            >
              <FiArrowLeft aria-hidden="true" />
            </button>
            <span id="hunt-page" className="muted" role="status"></span>
            <button
              id="hunt-next"
              className="button small subtle"
              type="button"
              aria-label="Next Miscrits"
            >
              <FiArrowRight aria-hidden="true" />
            </button>
          </div>
          <div className="hunt-selection-heading">
            <h3>Selected targets</h3>
            <button
              id="clear-all-targets"
              type="button"
              className="text-button"
              disabled
            >
              Clear all
            </button>
          </div>
          <div id="target-list" className="target-list"></div>
          <p id="target-empty" className="hint">
            No targets yet. Choose a portrait above.
          </p>
          <details className="hunt-details">
            <summary>Route order</summary>
            <p className="fine-print">
              Use &#8593; / &#8595; to set the order. &#9733; Main searches a
              target first when ready. Unavailable targets are skipped until
              their map or schedule opens.
            </p>
            <div id="hunt-route-list" className="hunt-route-list"></div>
          </details>
          <div className="card-footer">
            <span className="mint-dot"></span> Save settings after changing
            targets <span className="footer-right" id="mapped-count"></span>
          </div>
        </article>
        <article className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">2 &middot; SET CAPTURE RULES</span>
              <h2>Capture rules</h2>
            </div>
            <span className="gear">
              <FiSettings aria-hidden="true" />
            </span>
          </div>
          <label htmlFor="mode">What should happen?</label>
          <select id="mode">
            <option value="manual_target">Pause when a target appears</option>
            <option value="capture_targeted">Catch selected species</option>
            <option value="capture_rated">Catch any species</option>
            <option value="capture_missing">
              Catch missing collection families
            </option>
            <option value="fight">Fight every encounter</option>
          </select>
          <p className="hint" id="mode-help">
            Automation pauses when your selected target appears. Continue in
            Live battle.
          </p>
          <div className="capture-grade-field">
            <span id="rating-label" className="field-label">
              Minimum grade
            </span>
            <input
              id="rating"
              type="number"
              min="0"
              max="18"
              defaultValue="17"
              hidden
            />
            <div
              id="rating-grades"
              className="rating-grades"
              role="group"
              aria-labelledby="rating-label"
            ></div>
            <p id="rating-help" className="hint"></p>
          </div>
          <label htmlFor="threshold">
            Try a free capture when the chance reaches
          </label>
          <div className="capture-threshold">
            <div className="input-unit">
              <input
                id="threshold"
                type="number"
                min="1"
                max="100"
                defaultValue="70"
              />
              <span>%</span>
            </div>
            <span className="hint">The chance comes from the game server.</span>
          </div>
          <p id="capture-plan" className="capture-plan" role="status"></p>
          <details className="hunt-details hunt-advanced">
            <summary>Advanced capture settings</summary>
            <label htmlFor="search-interval">Seconds between searches</label>
            <input
              id="search-interval"
              type="number"
              min="3"
              max="120"
              defaultValue="8"
            />
            <p className="hint">
              Slower pacing reduces request frequency. It cannot remove a server
              daily limit.
            </p>
            <label className="switch-row">
              <div>
                <strong>Run from unwanted encounters</strong>
                <small>Flee on a legal turn when the target rules fail.</small>
              </div>
              <input id="flee" type="checkbox" role="switch" defaultChecked />
            </label>
            <label className="switch-row">
              <div>
                <strong>Ignore minimum grade for selected targets</strong>
                <small>
                  Selected hunt and training targets can be caught at any grade.
                  Automatic training still needs S (17) or S+ (18).
                </small>
              </div>
              <input id="capture-low-rating" type="checkbox" role="switch" />
            </label>
            <label className="switch-row">
              <div>
                <strong>Remove targets after a kept capture</strong>
                <small>
                  Removes the species from Your next great find after keep
                  confirmation, including lower-rated captures. Its tier
                  training entry stays selected to seek a 17+ upgrade.
                </small>
              </div>
              <input
                id="remove-captured-targets"
                type="checkbox"
                role="switch"
                defaultChecked
              />
            </label>
            <label htmlFor="max-attacks">Maximum weakening attacks</label>
            <input
              id="max-attacks"
              type="number"
              min="1"
              max="50"
              defaultValue="12"
            />
          </details>
          <button className="button save full">Save capture rules</button>
          <p className="hint">Save, then press Start automation at the top.</p>
          <p className="fine-print">
            Search cooldowns and spawn chances follow the game server. Capture
            retries that cost platinum are disabled.
          </p>
        </article>
      </div>
    </section>
  );
}

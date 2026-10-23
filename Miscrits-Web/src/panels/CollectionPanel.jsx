// Static controls are wired by the existing automation controller.
export default function CollectionPanel() {
  return (
    <section id="tab-collection" className="tab-panel" hidden>
      <div className="collection-overview" aria-label="Collection overview">
        <article className="card">
          <span className="eyebrow">OWNED FAMILIES</span>
          <strong id="collection-owned">-</strong>
          <small id="collection-copies">Sign in to load your collection</small>
        </article>
        <article className="card">
          <span className="eyebrow">STILL MISSING</span>
          <strong id="collection-missing">-</strong>
          <small>Not in your current owned roster</small>
        </article>
        <article className="card">
          <span className="eyebrow">BEST COPIES 17+</span>
          <strong id="collection-qualified">-</strong>
          <small>Families with a rating-17+ copy</small>
        </article>
        <article className="card">
          <span className="eyebrow">LEVEL 30 COMPLETE</span>
          <strong id="collection-complete">-</strong>
          <small>Owned level 30+ or captured fourth form</small>
        </article>
      </div>
      <div className="collection-notice">
        <p id="collection-source" className="hint" role="status">
          Sign in to inspect your collection.
        </p>
        <button
          id="collection-account-action"
          className="button small"
          type="button"
        >
          Sign in
        </button>
      </div>
      <div
        id="collection-tiers"
        className="collection-tiers"
        aria-label="Progress by tier"
      ></div>
      <article className="card collection-browser">
        <div className="card-heading">
          <div>
            <span className="eyebrow">YOUR FIELD GUIDE</span>
            <h2>Every family, one clear record</h2>
          </div>
          <span
            id="collection-result-count"
            className="badge"
            aria-live="polite"
          >
            Sign in to load
          </span>
        </div>
        <div className="collection-filters">
          <div>
            <label htmlFor="collection-search">Search</label>
            <input
              id="collection-search"
              type="search"
              placeholder="Species, evolution or nickname"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="collection-tier">Tier</label>
            <select id="collection-tier">
              <option value="all">All tiers</option>
              <option>Exotic</option>
              <option>Rare</option>
              <option>Common</option>
              <option>Epic</option>
              <option>Legendary</option>
              <option value="Unlisted">Unlisted tier</option>
            </select>
          </div>
          <div>
            <label htmlFor="collection-ownership">Ownership</label>
            <select id="collection-ownership">
              <option value="all">All species</option>
              <option value="owned">Owned</option>
              <option value="missing">Missing</option>
            </select>
          </div>
          <div>
            <label htmlFor="collection-rating">Best rating</label>
            <select id="collection-rating">
              <option value="all">Any rating</option>
              <option value="qualified">17+ copies</option>
              <option value="below">Owned below 17</option>
            </select>
          </div>
          <div>
            <label htmlFor="collection-completion">Level 30</label>
            <select id="collection-completion">
              <option value="all">Any progress</option>
              <option value="complete">Completed</option>
              <option value="incomplete">Not completed</option>
              <option value="unknown">Index unconfirmed</option>
            </select>
          </div>
          <div>
            <label htmlFor="collection-sort">Sort by</label>
            <select id="collection-sort">
              <option value="tier">Tier, then name</option>
              <option value="name">Name</option>
              <option value="rating">Best rating</option>
              <option value="level">Highest owned level</option>
            </select>
          </div>
        </div>
        <p className="fine-print">
          One record per species family, including its evolutions. Completion is
          defaultChecked across every owned copy and the Miscrits index, so a
          better duplicate does not reset progress.
        </p>
        <div id="collection-grid" className="collection-grid"></div>
        <p id="collection-empty" className="empty" hidden>
          No species match these filters.
        </p>
        <div className="collection-pagination">
          <button
            id="collection-prev"
            className="button small subtle"
            type="button"
          >
            Previous
          </button>
          <span id="collection-page" className="muted" aria-live="polite">
            Page 1
          </span>
          <button
            id="collection-next"
            className="button small subtle"
            type="button"
          >
            Next
          </button>
        </div>
      </article>
    </section>
  );
}

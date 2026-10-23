// Static controls are wired by the existing automation controller.
export default function HistoryPanel() {
  return (
    <section id="tab-history" className="tab-panel" hidden>
      <article className="card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">SESSION HISTORY</span>
            <h2>Activity log</h2>
          </div>
          <span id="history-count" className="badge">
            0 records
          </span>
        </div>
        <div id="history"></div>
      </article>
    </section>
  );
}

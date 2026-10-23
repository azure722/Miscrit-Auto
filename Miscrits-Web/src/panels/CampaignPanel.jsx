// Static controls are wired by the existing automation controller.
export default function CampaignPanel() {
  return (
    <section id="tab-campaign" className="tab-panel" hidden>
      <div className="two-columns">
        <article className="card">
          <span className="eyebrow">AUTOMATION SETTINGS</span>
          <h2>Campaign rules</h2>
          <p className="muted">
            Fight unlocked stages with your current team. Stop on defeat, daily
            limits, or the victory limit you choose.
          </p>
          <label htmlFor="campaign-limit">Victories before stopping</label>
          <input
            id="campaign-limit"
            type="number"
            min="1"
            max="10"
            defaultValue="10"
          />
          <button className="button save full">Save campaign settings</button>
        </article>
        <article className="card">
          <span className="eyebrow">BEFORE EACH STAGE</span>
          <h2>Keep the team ready</h2>
          <div className="check-line">
            <span>01</span>
            <div>
              <h3>Use your active team</h3>
              <p>
                Set your four slots in Your team before starting.
              </p>
            </div>
          </div>
          <div className="check-line">
            <span>02</span>
            <div>
              <h3>Heal if two teammates faint</h3>
              <p>
                Uses the normal 10 virtue heal. Stops when virtue is
                insufficient.
              </p>
            </div>
          </div>
          <div className="check-line">
            <span>03</span>
            <div>
              <h3>Continue after a confirmed win</h3>
              <p>
                Checks campaign progress before creating the next stage. No
                duplicate requests.
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

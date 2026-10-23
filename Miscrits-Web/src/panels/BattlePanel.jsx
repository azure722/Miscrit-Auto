// Static controls are wired by the existing automation controller.
import {FiZap} from 'react-icons/fi';
export default function BattlePanel() {
  return (
    <section id="tab-battle" className="tab-panel" hidden>
      <article className="card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">YOU'RE IN CONTROL</span>
            <h2 id="battle-title">Live battle</h2>
          </div>
          <span id="turn" className="badge">
            No active battle
          </span>
        </div>
        <div id="battle-empty" className="empty">
          <FiZap aria-hidden="true" />
          <h3>No active battle</h3>
          <p>
            Your next encounter will appear here. You can play manually from
            this tab.
          </p>
        </div>
        <div id="battle-content" hidden>
          <div className="combatants">
            <div id="battle-player"></div>
            <span className="versus">VS</span>
            <div id="battle-foe"></div>
          </div>
          <p id="capture-chance" className="hint"></p>
          <div id="abilities" className="abilities"></div>
          <div id="switches" className="chips"></div>
          <div className="battle-actions">
            <button id="capture" className="button primary">
              Free capture
            </button>
            <button id="keep" className="button primary" hidden>
              Keep captured Miscrit
            </button>
            <button id="flee-action" className="button subtle">
              Run away
            </button>
          </div>
          <p className="fine-print">
            Pause automation to use manual actions. Only the first free capture
            attempt is enabled.
          </p>
        </div>
      </article>
    </section>
  );
}

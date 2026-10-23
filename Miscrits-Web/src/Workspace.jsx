import { memo } from "react";
import {FiX,FiCommand} from 'react-icons/fi';
import HuntPanel from "./panels/HuntPanel.jsx";
import CampaignPanel from "./panels/CampaignPanel.jsx";
import TeamPanel from "./panels/TeamPanel.jsx";
import BattlePanel from "./panels/BattlePanel.jsx";
import ArenaPanel from "./panels/ArenaPanel.jsx";
import WorkflowPanel from "./panels/WorkflowPanel.jsx";
import CollectionPanel from "./panels/CollectionPanel.jsx";
import HistoryPanel from "./panels/HistoryPanel.jsx";
export const Overview = memo(function Overview() {
  return (
    <>
      <section className="stats" aria-label="Player overview">
        <article>
          <span>TRAINER</span>
          <strong id="trainer">Not connected</strong>
          <small id="player-level">Sign in to load your account</small>
        </article>
        <article>
          <span>YOUR COLLECTION</span>
          <strong id="collection">—</strong>
          <small>Owned Miscrits</small>
        </article>
        <article>
          <span>VIRTUE</span>
          <strong id="virtue">—</strong>
          <small>10 per campaign team heal</small>
        </article>
        <article>
          <span>SESSION WINS</span>
          <strong id="wins">0</strong>
          <small>Campaign victories</small>
        </article>
      </section>
      <div id="notice" className="notice" role="status">
        <span className="pulse"></span>
        <div>
          <strong id="status">Sign in to your Miscrits account.</strong>
          <small id="data-status">Loading official game data…</small>
        </div>
        <button
          id="open-stop-report"
          className="button small subtle"
          type="button"
        >
          Stop report
        </button>
        <button id="connect" className="text-button">
          Connect account ↗
        </button>
      </div>
    </>
  );
});
export const Workspace = memo(function Workspace() {
  return (
    <>
      <HuntPanel />
      <CampaignPanel />
      <TeamPanel />
      <BattlePanel />
      <ArenaPanel />
      <WorkflowPanel />
      <CollectionPanel />
      <HistoryPanel />
    </>
  );
});
export const AccountDialog = memo(function AccountDialog() {
  return (
    <>
      <dialog id="login-dialog">
        <form id="login-form">
          <button
            className="dialog-close"
            type="button"
            id="close-login"
            aria-label="Close sign in"
          >
            <FiX aria-hidden="true" />
          </button>
          <span className="brand-icon"><FiCommand aria-hidden="true" /></span>
          <span className="eyebrow">CONNECT ACCOUNT</span>
          <h2>Sign in to Miscrits</h2>
          <p className="muted">
            Sign in with your Miscrits account. Your password is sent to the
            official game service and is never saved.
          </p>
          <label htmlFor="identity">Miscrits username or email</label>
          <input
            id="identity"
            autoComplete="username"
            required
            maxLength="160"
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength="8"
            maxLength="256"
          />
          <p id="login-error" className="error" role="alert"></p>
          <button className="button primary full" id="sign-in">
            Sign in
          </button>
          <p className="fine-print">
            Use one game client at a time to avoid competing sessions. This is a
            personal, unofficial client.
          </p>
        </form>
      </dialog>
      <div id="toast" className="toast" role="alert" hidden />
    </>
  );
});

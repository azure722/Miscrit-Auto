import React, { useEffect, useState } from "react";
import {
  FiCrosshair,
  FiFlag,
  FiAward,
  FiUsers,
  FiZap,
  FiGitBranch,
  FiGrid,
  FiClock,
  FiMoon,
  FiSun,
  FiCpu,
  FiArrowRight,
  FiPlay,
  FiCommand,
} from "react-icons/fi";
import { Overview, Workspace, AccountDialog } from "./Workspace.jsx";
import { initializeWorkspace } from "./controller.js";

const navigation = [
  ["hunt", "Hunt & capture", FiCrosshair],
  ["campaign", "Campaign", FiFlag],
  ["arena", "Arena", FiAward],
  ["team", "Your team", FiUsers],
  ["battle", "Live battle", FiZap],
  ["workflow", "Workflow", FiGitBranch],
  ["collection", "Collection", FiGrid],
  ["history", "Activity log", FiClock],
];

function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "dark",
  );
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("miscrits-theme", next);
    } catch {}
  }
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <FiSun aria-hidden="true" />
      ) : (
        <FiMoon aria-hidden="true" />
      )}
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Miscrits Field Station home">
        <span className="brand-icon">
          <FiCommand aria-hidden="true" />
        </span>
        <span>
          Miscrits<small>FIELD STATION</small>
        </span>
      </a>
      <span className="nav-label">AUTOMATION</span>
      <nav aria-label="Main navigation">
        {navigation.map(([id, label, Icon], index) => (
          <React.Fragment key={id}>
            {index === 5 && (
              <span className="nav-label secondary-label">MANAGE</span>
            )}
            <button
              type="button"
              className={`nav${id === "hunt" ? " active" : ""}`}
              data-tab={id}
              aria-current={id === "hunt" ? "page" : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {id === "battle" && <i id="battle-dot" hidden />}
            </button>
          </React.Fragment>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-status">
          <FiCpu aria-hidden="true" />
          <div>
            <strong>Local workspace</strong>
            <small>Headless game automation</small>
          </div>
          <span className="mint-dot" />
        </div>
        <p>
          Runs in the background.
          <br />
          You stay in control.
        </p>
        <small>Personal client · Game 2.23.0</small>
      </div>
    </aside>
  );
}

export default function App() {
  useEffect(() => initializeWorkspace(), []);
  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <Sidebar />
      <div className="shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span className="breadcrumb">Workspace</span>
            <FiArrowRight className="slash" aria-hidden="true" />
            <span id="page-label">Hunt & capture</span>
          </div>
          <div className="account">
            <span id="connection" className="connection">
              Offline
            </span>
            <ThemeToggle />
            <button id="account-button" className="button subtle" type="button">
              Sign in
            </button>
          </div>
        </header>
        <main id="workspace" tabIndex="-1">
          <div className="page-heading">
            <div>
              <div className="eyebrow">AUTOMATION WORKSPACE</div>
              <h1 id="page-title">Hunt & capture</h1>
              <p id="page-description">
                Choose targets and set your capture rules.
              </p>
            </div>
            <div className="run-control">
              <button id="run" className="button primary" disabled>
                <FiPlay aria-hidden="true" /> Start automation
              </button>
              <small>
                <kbd>F8</kbd> to start or pause
              </small>
            </div>
          </div>
          <Overview />
          <Workspace />
          <footer className="page-footer">
            <span>
              <FiCpu aria-hidden="true" /> Local backend · Headless automation
            </span>
            <span>Settings stay on this device</span>
          </footer>
        </main>
      </div>
      <AccountDialog />
    </>
  );
}

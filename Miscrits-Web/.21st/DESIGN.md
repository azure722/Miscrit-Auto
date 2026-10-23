# Miscrits Field Station design

React 19 and Vite dashboard with React Icons. Shared semantic colors in `src/styles.css` use slate surfaces, teal actions and amber availability labels. Dark is the default regardless of OS appearance. The user can choose light mode; only that appearance preference is stored in localStorage.

Use plain task headings, compact navigation, thin borders and modest radii. Avoid decorative gradients, promotional headlines and unnecessary animation. Hunt uses portrait grids, rarity filters, 24 items per page and bounded scrolling. Account map gates and daily schedules come from the route planner. Native details sections contain route priority and advanced settings. Preserve visible focus, disabled states, skip navigation, reduced motion and mobile layouts.

The React component tree is in `src/App.jsx`, `src/Workspace.jsx` and `src/panels/`. TeamPanel is fully reactive through `src/team-store.js`; its active team, inventory, HP/XP bars and controls use React state. The remaining automation controls still use dedicated containers owned by `src/controller.js`; keep those components stable. Team styles in `src/team.css` load after the shared styles. Theme changes preserve unsaved edits. Game policies and the local Node API remain in `lib/` and `server.mjs`.

Your team has one immediate-save auto level-up switch in the active-team header, per-copy platinum bonus switches, green HP and blue XP progress bars, and an owned-copy inventory. Preserve the independent copy IDs when swapping or granting upgrade permission. Support native drag/drop and keyboard/touch slot selection. Automatic team selection, replacement lists and tier-training controls are removed from the website.

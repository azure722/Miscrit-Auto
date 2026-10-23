# Browser auto level-up

This document records earlier training behavior. The current website replaces tier training and automatic replacements with an owned inventory and manual team swaps. See [Team management](WEB-TEAM-MANAGEMENT.md) for the active-team toggle, per-copy platinum bonuses and current UI.

In Your team, enable Auto level-up > Level up with earned XP, save training settings, and start automation. This setting defaults off and applies to both hunting and campaign. Team cards show XP and whether each teammate is ready. Only the active team is trained, up to level 35.

The level 1–34 XP thresholds were extracted from the current native game's `Utils.get_exp_needed`, which reads `Constants.xps`. Both normal (`exp`, `level`) and compact v2 (`x`, `l`) owned records are supported. Missing or malformed XP cannot authorize training.

## Selected collection training

Enable **Train best 17+ copies to level 30** in Your team and use the separate replacement list. Slot 1 remains the lead. Each selected species contributes at most one highest-rated copy, with minimum rating 17. Selection and earned-XP training prioritize Exotic, then Rare, Common, Epic and Legendary. Rating ties prefer higher level, then lower ID. Already completed best copies prevent training weaker copies of that species. Up to three trainees fill slots 2–4; completed trainees yield their slot to the next eligible family. General auto level-up remains optional for the lead; selected slots stop at 30 even when that general switch and level-35 replacement are enabled.

In wild hunts, species without a qualifying copy are queued for capture, with Exotic requests first. The Collection capture mode captures previously unowned families and qualifying rating-17+ upgrades from that queue. Below-16 copies of queued species are not captured. Owned encounters can supply XP while selected trainees remain. No platinum training, token use or bonus purchase is added. Current ownership is refreshed between battles; successful keep acknowledgements suppress duplicate captures of the same family within a battle, including qualifying upgrades. Team saves are verified before training or another search and are never blindly repeated after an uncertain result.

Collection capture, tier priority, the rating threshold, team selection, the level-30 cap and failures are covered by automated tests. Live XP training was verified in the earlier check below; an Exotic rating-17+ capture and the full new workflow have not been forced or verified on the live account.

## Tier groups and index deduplication

The updated order is Exotic, Rare, Common, Epic, Legendary. Each UI group can add owned qualifying families or mapped missing/upgrade targets; batch additions use a set so families are not repeated. Replacement lists can hold a complete catalog tier. Hunt target lists retain their 100-name limit.

Login loads the official `get_player_seen` index. Selected automation checks it at most once every 30 seconds and again during connection recovery. The native `Miscrit.update_seen` method interprets each decimal digit as an evolution flag: zero is unknown, positive is seen, and two is captured. A captured fourth form proves that the family has reached level 30. This completes the family even if its old copy is no longer owned. Any owned copy at level 30+ also completes the family regardless of its rating. Therefore, a new higher-rated copy cannot cause duplicate selected training or a selected upgrade hunt. Merely seeing the fourth form does not prove completion. Native index flags contain no historical rating information.

Unavailable or malformed index data stops selected automation before mutation. Index state is cleared on logout and stale responses cannot restore it into another account. General training cannot bypass this duplicate protection on a fresh lead copy while selected training is enabled.

Read-only live validation with the authorized dummy account confirmed the index response: 16 indexed families and one captured fourth evolution. No team, XP, battle, or currency mutation was sent. Report: `validation/web-index-live.json`. Tier batch actions, index decoding, released completed families, higher-rated duplicates, and failed/stale index responses are also covered by automated checks. The complete tier capture/training workflow and rendered layout still need live visual validation.

Between battles, a refreshed player record must show enough earned XP before sending the native `xp_train` request with `miscritId` and `currLevel`. Only one training request can run at a time. The authoritative roster is refreshed afterward and must confirm exactly one new level. The next cycle rechecks team, XP, pause state, and level-35 replacements. No paid training, XP-token training, or platinum bonus request is made. Rejections pause; unknown mutation results block restart until a new sign-in.

118 automated checks pass, including training eligibility, both record formats, max-level exclusion, pause while training is pending, campaign/hunting operation, failure handling, and replacement after reaching 35. An isolated live check with the authorized dummy account trained one eligible active teammate from level 1 to 2, confirmed through `get_player`. No platinum or virtue was spent, no battle was created, and website preferences/history were untouched. See `validation/web-training-live.json`. Desktop/mobile visual verification remains unavailable in this session.

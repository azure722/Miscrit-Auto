# Area access correction

The picker previously checked outdoor map entry achievements but omitted the separate boss gates for areas 2, 3 and 4. As a result, a partially unlocked Miscrian Jungle account could select Bunaken or Light Lavarilla and attempt `update_location` directly to area 4. The user confirmed that Magicite Goremand had not been defeated.

The shared route planner now checks the individual area boss for Forest, Mount Gemma, Sunfall Shores, Miscrian Jungle and Monks Mountain, alongside the existing special map, ticket and indoor area gates. Picker availability, saved hunt routes and Workflow reasons use the same result. The catalog maps Bunaken and Light Lavarilla to Jungle area 4; ordinary Lavarilla retains its alternate Mansion route when unlocked. The live official spawn feed is also required to still contain the mapped area.

Evidence: the previously exported native `extracted-assets/map-scenes.json` identifies the regional Magicite NPC gates and `mapping-source/singletons/constants.gd` identifies their boss keys; the official Miscrits feed confirms the three families' spawn areas. The user's partial-Jungle/Goremand confirmation establishes the reported area-4 failure. No new game login or live hunt was performed.

Definitively rejected travel is excluded from subsequent routes in that account session and is labelled Travel rejected rather than guessed to be a map lock. Ordinary account polling preserves the exclusion; account recovery or changed boss/ticket data clears it. Timeout and uncertain results retain the existing pause behavior.

State `huntAccessVersion: 2` identifies the new rules. The new frontend refuses to start a hunt against the earlier map-only backend. Health version 16 and the launcher provide an explicit update/restart instruction for a stale process.

Validation: 185 Node tests passed. New checks cover every outdoor area gate, the actual Bunaken/Light Lavarilla catalog entries, unlocked alternate locations, saved targets making zero travel/search requests to locked areas, progression after Goremand, stale spawn removal, rejected-area suppression and older-backend compatibility. An isolated real-backend browser fixture with partial Jungle achievements verified disabled portraits, boss explanations, selected-target status, Workflow reasons and no mobile horizontal overflow. It did not use the real game account.

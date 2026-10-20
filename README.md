# POS Desktop updates

Signed delta delivery for [POS Desktop](https://github.com/ABDO-TECK/pos-desktop).

Previous demonstration releases and tags were archived locally and removed at the owner's request. This repository is ready for real feature and repair updates; no new update is published merely to test delivery.

## Current complete Setup baseline

- Full Windows Setup: [Setup 0.0.1](https://github.com/ABDO-TECK/pos-desktop/releases/tag/v0.0.1).
- Application and displayed version inside the corrected Setup: 0.0.1.
- Baseline source tag in pos-desktop: v0.0.1.
- Exact build inventory: baselines/v0.0.1/deployment-inventory.json.
- Previously allocated application revision0.0.9 remains in source history; use the next unused revision0.0.10 (or0.0.10-beta.1), preserving monotonic comparison. Full Setup and application versions agree; subsequent deltas can advance the application revision without replacing the shell.

## Publish a future change

1. Implement and verify the actual feature or repair in pos-desktop. Keep the Setup shell/package inputs unchanged for a delta. Electron/runtime changes require another complete Setup.
2. Set an increasing application revision in version.json, release_type delta, the intended channel, and delta_baseline_tags including v0.0.1 for direct delivery to current Setup installations. Commit and tag that source revision.
3. Run Signed delta release here with the matching source_ref/tag. Leave publish false for validation; set publish true only for the actual release.
4. Stable tags vX.Y.Z are normal releases and marked Latest. Beta tags vX.Y.Z-beta.N are prereleases; beta clients can promote to a newer stable.

Signing uses the retained encrypted UPDATE_PRIVATE_KEY Actions secret and the existing pinned public key. Publishing uses this repository's GITHUB_TOKEN, without a cross-repository write credential. Only changed deployed artifacts enter a signed per-baseline package; local business data, configuration and printing keys remain excluded.

The corrected Setup includes executable branding and POS-owned data cleanup on manual uninstall. Reinstallation after uninstall starts fresh and displays new temporary administrator credentials. Setup upgrades preserve data. The older 0.0.8 demonstration shell has a different fingerprint and is not a supported baseline for this corrected shell.

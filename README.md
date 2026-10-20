# POS Desktop updates

Signed delta delivery for [POS Desktop](https://github.com/ABDO-TECK/pos-desktop).

- Stable: vX.Y.Z, normal releases.
- Beta: vX.Y.Z-beta.N, prereleases. Beta clients may promote to a newer stable revision.
- Full Windows Setup downloads live only in the source repository.
- Run the Signed delta release workflow with a source tag/ref and matching application revision tag. Signing uses this repository's UPDATE_PRIVATE_KEY secret; publishing uses its own GITHUB_TOKEN.
- Source shell package stays at the current Setup version; internal update revisions increase independently.
- Existing signed manifests are copied byte-for-byte. Installation verifies the pinned RSA key and exact baseline hashes.

Build-only Setup inventories are stored under baselines/vX.Y.Z/deployment-inventory.json, outside Releases. Release records are reserved for installable signed deltas; current stable is marked Latest.

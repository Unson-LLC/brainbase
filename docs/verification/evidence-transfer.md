# Evidence bundle transfer integrity

Before comparing historical task-save evidence, obtain the original files and a
manifest from their custodian. This local, read-only tool checks whether received
bytes match that manifest. It never fetches, uploads, or prints evidence contents.

```sh
node scripts/verify-evidence-bundle.mjs /path/to/received-bundle /path/to/manifest.json
```

The manifest uses this format (replace the sample values with the provider's actual
byte count and lowercase SHA-256 digest):

```json
{
  "schema": "evidence-transfer-v1",
  "files": [
    { "path": "nested/evidence.json", "bytes": 123, "sha256": "<64 lowercase hexadecimal characters>" }
  ]
}
```

Paths are relative to the bundle root. Duplicates, absolute paths, traversal,
symlink files and symlink directories are rejected. Missing files, byte count or
digest mismatches, and malformed manifests exit with status 1. Exact matches exit
with status 0 and `integrityMatched: true`. Extra files are ignored; only listed
files are read. Keep the bundle unchanged while checking it; this is an offline
transfer check, not a sandbox for files changed concurrently by another process.

For the task-save migration, the manifest must list all six original evidence
files named in the baseline work package. Review that list separately: this tool
accepts any nonempty file list and does not establish completeness of a work
package. Store the manifest and output alongside the received evidence outside
version control; do not commit private evidence.

A matching digest proves only agreement with the supplied manifest. It does not
prove the manifest's provenance, historical source revisions, execution artifact
hashes, permission equivalence, or the eleven evidence correspondences. Generating
a new manifest from received files cannot establish transfer integrity against the
provider's originals. The baseline comparison must retain its unverified rows
until the originals and their schema are checked. Production switching and legacy
removal still require the separate migration gates (UNS-61 / UNS-231).

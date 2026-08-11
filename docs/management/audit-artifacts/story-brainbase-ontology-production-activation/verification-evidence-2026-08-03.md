# Ontology 1.0.0 activation verification evidence

- Candidate HEAD: `2a38a3f9befe54537c0f909b3fe33f5eb7032a83`
- Source commit: `ef12ffabd109d75d2a55d3802daa44f2160aa333`
- Publication commit: `e794299c5f19f8d46747a39422420b68176ed14b`
- Release digest: `9d794651151e77c543f00160d705d55c11b4af7e4388114da6923cb567970db4`

## Exact remediation precondition

The saved remediation and authority backup manifests were SHA-256 bound. A read-only production snapshot was reversed through those manifests to reconstruct the 7,403 entity / 6,680 edge pre-remediation state. Hashing every selected entity and edge column produced `da6faee2640908ef93007c1d8eb77a4e0226fe62a5ba6843867566db01216458`, which is the code precondition. Metadata drift tests cover `project_id`, `role_min`, and `sensitivity` on both entities and edges.

## Independent rollback rehearsal

An independent detached worktree at Candidate HEAD ran `git revert --no-commit e794299c5f19f8d46747a39422420b68176ed14b`, confirmed the receipt was absent and the index was `{current:null, release_count:1, status:"proposed", receipt_path:null}`, then ran `npm run ontology:verify` successfully. The rehearsal did not mutate Graph or the production runtime.

## Production Graph and signed artifact readback

An independent production-host checkout at Candidate HEAD loaded the value-hidden production runtime projection. `node scripts/ontology-shadow-audit.js --version 1.0.0` completed a read-only full snapshot with 7,410 entities, 6,716 edges, 0 violations, and release digest `9d794651151e77c543f00160d705d55c11b4af7e4388114da6923cb567970db4`. `npm run ontology:verify` also passed with `current: 1.0.0` and one release.

This is pre-merge evidence. The production service still runs the previous deployed revision; merge, deploy, service health, runtime API readback, post-restart audit, and logs remain required before activation is complete.

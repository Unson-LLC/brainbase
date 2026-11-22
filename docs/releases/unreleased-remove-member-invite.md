# Organization member invitation removed from the OSS core — unreleased (breaking)

Unreleased; publish needs separate approval. The latest npm release is 0.50.22,
which still contains this module. The release that first ships this change must
call it out as a breaking change and choose its version accordingly. See also
`unreleased-remove-resource-reservations.md` (#1033) for the earlier removal
that is also still unreleased.

## Removed public surface

| Kind | Name | Note |
|---|---|---|
| package export | `@unson/brainbase-mcp/organization-member-invite` | `OrganizationMemberInviteService`, `OrganizationMemberInviteError`, `createInMemoryOrganizationMemberInviteRepository`, `createOrganizationMemberInviteId`, `normalizeOrganizationMemberInviteEmail` and the port types |
| package export | `@unson/brainbase-mcp/organization-member-invite-http` | `createOrganizationMemberInviteHttpHandler`, `ORGANIZATION_MEMBER_INVITE_HTTP_VERSION` and the `/api/v1/organization-member-invites` routes |

An invitation has a tenant, an inviter, a role, an authorization policy, a
membership binding and an audit trail. That is organization administration,
which the OSS boundary keeps out of the single-owner runtime (decided
2026-11-20, the same reason as the resource reservations). The kernel and the
HTTP handler now live in brainbase-organization
`packages/server-parts/organization-member-invites` (`kernel.js`, `http.js`),
next to its PostgreSQL repository (Unson-LLC/brainbase-organization#1473). The
behaviour, error codes and messages and the stored record shape are unchanged.

`verification/SKILL.md` was the invitation verification; it now verifies the
package as a whole with the same RUNNER_VERIFY record.

## Consumers checked (2026-11-20)

- brainbase-organization `main` (`29d8543`): no runtime import. Only the
  PostgreSQL integration test loaded the OSS build through the
  `MEMBER_INVITE_KERNEL_MODULE` environment variable; #1473 replaces that with
  the moved kernel.
- brainbase-unson `main` (`4c2dcc5`) and `develop` (`9e218c7`): no use.

Check these again at the version bump.

## Migration

Import `OrganizationMemberInviteService` and the HTTP handler from
`@unson/brainbase-organization-server-parts/organization-member-invites/kernel`
and `/http`.

No npm publication, version bump or deployment is included.

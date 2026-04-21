---
name: team
version: "1.0"
provides:
  commands:
    - team:staff:list
    - team:staff:get
permissions: []
---

# team module

Owns the organization's staff domain profile — the facts the business cares about
for routing and operations, *not* identity or auth.

## Ownership split

| Fact | Home |
|---|---|
| Identity, password, auth role | better-auth `user` + `member` |
| Team membership | better-auth `teamMember` (teams plugin — wired in T2) |
| Channel identities | `contacts.staff_channel_bindings` |
| Domain profile (sectors, expertise, capacity, attributes) | `team.staff_profiles` |
| Narrative persona (human-authored) | `team.staff_profiles.profile` ↔ Drive `scope=staff, path=/PROFILE.md` |
| Distilled agent memory | `team.staff_profiles.notes` ↔ Drive `scope=staff, path=/NOTES.md` |
| Permissions | better-auth AC statement (T2) |

## Tables

- `team.staff_profiles` — `userId PK`, org-scoped profile, availability check,
  GIN indexes on `sectors`/`expertise`/`languages`, `lastSeenAt` for presence,
  `profile` (human) + `notes` (agent, rewritten by the memory-distill observer).
- `team.staff_attribute_definitions` — clone of `contact_attribute_definitions`.
  Deliberate duplication so the two namespaces evolve independently.

## HTTP surface

- `GET /api/team/staff`
- `POST /api/team/staff`
- `GET/PATCH/DELETE /api/team/staff/:userId`
- `PATCH /api/team/staff/:userId/attributes`
- `GET/POST /api/team/attributes`, `PATCH/DELETE /api/team/attributes/:id`

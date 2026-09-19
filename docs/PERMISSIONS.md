# ADVOKATE.IN — Permission Matrix

Every backend function re-checks the caller's **active membership** and
**effective permissions** before touching data. The matrix below is the
default shipped with each new organisation; firm administrators with the
*Edit role permissions* capability may tailor it per role under
**Settings → Permission matrix**. Two hard rules are enforced in code and
cannot be overridden:

- **Last-owner protection** — the final active Owner of an organisation
  cannot be demoted, suspended or removed.
- **Support-staff ceiling** — Support Staff (peons) can never be granted
  matter-wide, client-wide, internal-document or billing privileges, no
  matter what an administrator selects.

## Roles

Owner · Partner · Senior Associate · Associate · Junior · Paralegal ·
Accountant · Administrator · Support Staff

## Enforcement layers

1. **Organisation membership** — records are scoped to the caller's active
   organisation (`orgId`); cross-organisation reads are impossible.
2. **Active membership checks** — suspended or invited memberships resolve
   to no access at all, on every request.
3. **Role permissions** — the capability matrix below.
4. **Matter-level access** — a matter with a restricted team list is
   visible only to its listed team; Owner, Partner and Administrator see
   everything.
5. **Document-level access** — documents marked *internal* require the
   *View internal documents* capability; *shared* documents are readable by
   everyone who can open the matter, including the client portal.
6. **Action-specific permissions** — each mutation names one capability
   (e.g. *Record payments*) and throws when it is absent.

## Default matrix

✅ = granted by default · — = not granted

| Capability | Owner | Partner | Sr. Assoc. | Associate | Junior | Paralegal | Accountant | Admin | Support Staff |
|---|---|---|---|---|---|---|---|---|---|
| View all matters | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Open matters | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | — |
| Edit matters | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ | — |
| Close matters | ✅ | ✅ | — | — | — | — | — | — | — |
| Restrict matter teams | ✅ | ✅ | — | — | — | — | — | — | — |
| View all clients | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Add clients | ✅ | ✅ | — | — | — | — | — | ✅ | — |
| Edit clients | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ | — |
| Manage hearings | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ | — |
| Record orders | ✅ | ✅ | ✅ | — | — | — | — | ✅ | — |
| Manage tasks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅¹ |
| Write notes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅¹ |
| Upload documents | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | —² | ✅ | — |
| View internal documents | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | —² | ✅ | — |
| Log time | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — |
| Log expenses | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Draft invoices | ✅ | ✅ | — | — | — | — | ✅ | — | — |
| Record payments | ✅ | ✅ | — | — | — | — | ✅ | — | — |
| Invite team & clients | ✅ | ✅ | — | — | — | — | — | ✅ | — |
| Manage members | ✅ | — | — | — | — | — | — | ✅ | — |
| Edit role permissions | ✅ | — | — | — | — | — | — | ✅ | — |
| Edit firm profile | ✅ | — | — | — | — | — | — | ✅ | — |

¹ Support Staff manage and write only on matters to which they are
  assigned; they hold no *View all matters*, so all other matter data is
  invisible to them.

² The Accountant role deliberately excludes document capabilities: they
  see billing on matters, not case documents.

## Administration boundaries

- Firm administrators manage only the records their granted capabilities
  authorise, inside their own organisation.
- There is no platform super-user in the application: no platform
  administration path exposes confidential legal records. Anything outside
  an organisation (deployment/Convex dashboard) is infrastructure, not
  case access.

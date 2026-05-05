---
"@vobase/template": patch
---

# Side-by-side detail pages with vertical Drive

The contact and team detail pages now use a two-column layout on `lg` and up: identity sections on the left, the entity's Drive on the right. The previous stacked layout pushed Drive below the fold whenever the attributes list grew.

**Two sections per entity, one role each.** Native fields (Email/Phone/Segments/Marketing on contacts; Title/Availability/Capacity/Sectors/Expertise/Languages on staff) sit in a read-only `InfoCard` with an Edit button that opens the existing form dialog. Custom attributes sit in their own `InfoCard` with inline-editable rows, dirty-tracking, and a contextual `Save (N)` button that only appears while a field is dirty.

**Add new attributes from the detail page.** A `+ Add attribute` row at the end of the attributes card opens the existing `AttributeFormDialog` to create a new definition, which appears on every contact/staff member via query invalidation — no detour to `/contacts/attributes` or `/team/attributes` for one-off fields.

**Drive can stack vertically.** `DriveBrowser` takes a new `orientation: 'horizontal' | 'vertical'` prop; `vertical` switches the desktop grid from columns to rows so the file list sits on top and the preview stacks below. Detail pages pass `vertical` so Drive fits in a single right-column box; the standalone `/drive` page keeps the original horizontal split.

Other cleanup: removed the staff `Profile` field from the dialog (already covered by `/PROFILE.md` inside Drive), dropped the unused module-level `attribute-table` wrappers and the shared `src/components/attributes/attribute-table.tsx`, and removed the "Settings" section heading on the agent detail page so its `InfoCard` matches the other detail pages' style.

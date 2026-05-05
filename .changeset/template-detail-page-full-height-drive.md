---
"@vobase/template": patch
---

# Full-height Drive on detail pages, agent page joins side-by-side layout

Three follow-ups to the contact/team detail-page rework:

- **Agent detail page now uses the same two-column layout.** Settings + Save on the left, vertical-orientation Drive on the right. Save button is contextual — only renders while the form is dirty.
- **Drive panel fills the column on `lg+`.** Detail pages flip `PageBody` to `flex flex-col` and the grid container to `flex-1` so the right column claims all remaining vertical space; `DriveSection` takes `lg:h-full` to override the default `h-[60vh]`. Below `lg` Drive keeps the original 60vh box. Left column gets its own internal scroll if its sections exceed the available height.
- **Vertical Drive prefers content over file list.** When `orientation="vertical"` and a file is selected, the grid splits the panel `1fr` for the file list and `2fr` for the preview/editor (was `1fr/1fr`), so AGENTS.md / PROFILE.md / etc. get the room they need without shrinking the file list to nothing.

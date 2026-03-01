# Stitch API reference

Data structures returned by `get_screen`.

### Metadata schema
* **htmlCode** *(PRIMARY SOURCE)*: Signed `downloadUrl` requiring system-level fetch (curl) for redirects. Always download and read this HTML first — it is the authoritative source for structure, tokens, content, and assets.
* **screenshot** *(LAST RESORT)*: Visual `downloadUrl`. Only use if HTML download fails or is corrupt. Never describe a screenshot as a substitute for reading HTML.
* **deviceType**: Usually `DESKTOP` — target 2560px width as base layout.

### Technical mapping rules
1. **Element tracking**: Preserve `data-stitch-id` attributes as TSX comments for future design sync.
2. **Asset handling**: Extract background image URLs into `mockData.ts` — don't hardcode into styles.
3. **Style extraction**: The HTML `<head>` contains design tokens (colors, fonts, spacing, radii). Map these to Tailwind CSS variables in `src/globals.css`. Load the `shadcn-ui` skill for theming guidance when using shadcn components.

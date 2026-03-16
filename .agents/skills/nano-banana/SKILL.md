---
name: nano-banana
description: Generate and edit photorealistic images using the Gemini CLI nanobanana extension. Use for any request involving images, photos, illustrations, icons, diagrams, or visual assets — including lifelike editorial-style photography matching the project's visual identity. REQUIRED whenever image needs to be generated.
allowed-tools: Bash(gemini:*)
---

# Image Generation with Nano Banana

Generates high-quality images via the Gemini CLI's `nanobanana` extension.

## First-time Setup

Check the extension is installed:
```bash
gemini extensions list | grep nanobanana
```

If missing:
```bash
gemini extensions install https://github.com/gemini-cli-extensions/nanobanana
```

Confirm your API key is available:
```bash
[ -n "$GEMINI_API_KEY" ] && echo "configured" || echo "missing GEMINI_API_KEY"
```

## Core Commands

Always pass `--yolo` to suppress confirmation prompts.

| Task | Command |
|---|---|
| Generate from text | `gemini --yolo "/generate 'prompt'"` |
| Edit an existing image | `gemini --yolo "/edit file.png 'instruction'"` |
| Restore a damaged photo | `gemini --yolo "/restore photo.jpg 'remove scratches'"` |
| App icon or favicon | `gemini --yolo "/icon 'description'"` |
| Architecture / flow diagram | `gemini --yolo "/diagram 'description'"` |
| Repeating texture or pattern | `gemini --yolo "/pattern 'description'"` |
| Sequential narrative images | `gemini --yolo "/story 'description'"` |
| Natural language shorthand | `gemini --yolo "/nanobanana prompt"` |

## Project Reference Images

Two photographic reference styles are available in `ref-pics/`. Choose based on what the image needs to convey.

---

### People / Human-Focused Images → `ref-pics/human.png`

Use this reference when the image features a **person as the subject** — professionals at work, customer interactions, team scenes, or any human-centred shot.

**Reference style characteristics:**
- Warm, natural indoor lighting (window light, soft ambient)
- Subject is doing something purposeful — not posed or staged
- Shallow depth of field, medium or three-quarter shot
- Realistic setting: desk, office chair, casual workspace
- Clean, uncluttered composition with UI/product elements overlaid if needed

**Prompt formula:**
```
[person + role doing specific action], [detailed setting], [lighting],
[lens/composition cue], lifelike editorial photo, photorealistic, no text
```

**Example:**
```bash
gemini --yolo "/generate 'customer support specialist with headset smiling at monitor, open-plan modern office, warm natural window light from behind, shallow depth of field, lifelike editorial photo, photorealistic, no text' --preview"
```

**Checklist:**
- Subject is **engaged in a task**, not staring at camera
- Background has **environmental depth** (colleagues, plants, cityscape)
- **Natural or motivated lighting only** — no studio flash
- **No text, no logos** unless explicitly requested

---

### Architecture / Building Images → `ref-pics/skyscraper.png`

Use this reference when the image features a **building, landmark, or urban exterior** — bank headquarters, corporate campuses, financial district scenes, or any imposing architectural shot.

**Reference style characteristics:**
- Dramatic **worm's-eye / low-angle upward perspective** — shot from street level looking up
- Dark reflective glass and steel facade filling most of the frame
- Bright blue sky with dramatic white cumulus clouds reflected in the glass
- Flanking buildings on either side to create depth and scale
- Crisp, cinematic, midday or late-morning light

**Prompt formula:**
```
[building type] photographed from street level looking straight up, [facade material description],
[flanking buildings], bright blue sky with white clouds reflected in glass,
dramatic worm-eye low-angle perspective, photorealistic, cinematic, no text
```

**Example:**
```bash
gemini --yolo "/generate 'grand bank headquarters photographed from street level looking straight up, dark reflective glass and steel facade, flanking glass skyscrapers on both sides, bright midday blue sky with dramatic white clouds reflected in the glass panels, dramatic worm-eye low-angle perspective, photorealistic, cinematic, no text' --preview"
```

**Checklist:**
- Camera angle is **looking straight up from the base** — not eye-level or aerial
- Glass facade **reflects the sky and clouds**
- Other tall buildings **frame the left and right edges**
- **No text or signage** unless explicitly requested (e.g. bank name on stone lintel)

---

## Common Output Sizes

| Use case | Dimensions / Flag |
|---|---|
| Website hero (16:9) | `--aspect=16:9` |
| Blog / social preview | 1200×630 |
| Square social post | `--aspect=1:1` |
| LinkedIn / Twitter banner | 1500×500 |
| Portrait / story | `--aspect=9:16` |

## Generating Multiple Variations

```bash
gemini --yolo "/generate 'prompt' --count=3 --preview"
```

## Quality Upgrade

Default model is `gemini-2.5-flash-image`. For higher fidelity (4K, better faces):

```bash
export NANOBANANA_MODEL=gemini-3-pro-image-preview
```

## Output

All generated images land in `./nanobanana-output/`. After generation:
1. List the directory to find the file(s)
2. Present the image(s) to the user using the Read tool
3. Offer to iterate — adjust prompt, change count, or edit a specific result

## Iteration Patterns

| User says | Action |
|---|---|
| "try again" / "give me options" | Regenerate with `--count=3` |
| "make it more [adjective]" | Refine the prompt and regenerate |
| "tweak this one" | `gemini --yolo "/edit nanobanana-output/filename.png 'change'"` |
| "different style" | Add `--styles="requested_style"` |

## Troubleshooting

| Problem | Fix |
|---|---|
| `GEMINI_API_KEY` not set | `export GEMINI_API_KEY="your-key"` |
| Extension not found | Run install command above |
| Quota exceeded | Wait for reset or switch to flash model |
| Image fails policy check | Simplify prompt, remove ambiguous descriptors |

---
name: diceui
description: Build complex, accessible UI components using DiceUI — combobox, tags-input, sortable, kanban, data-table, file-upload, color-picker, and 40+ more. Use when the user wants to add any DiceUI component, mentions @diceui packages, asks for complex interactive components like combobox, sortable lists, kanban boards, mentions, file uploads, or any component that extends shadcn/ui with advanced interaction patterns. Also use when adding components like rating, stepper, timeline, tour, media-player, masonry, or cropper.
---

# DiceUI

[DiceUI](https://diceui.com) is an accessible component library that extends [shadcn/ui](https://ui.shadcn.com/) with complex, composable components built on React, TypeScript, Tailwind CSS, and Radix UI primitives.

Like shadcn/ui, DiceUI components are **copy-paste ready** — you own the source code. Components follow the compound component pattern with named sub-parts, are WCAG-compliant with proper ARIA attributes, and support full keyboard navigation.

## Installation

DiceUI components install via the shadcn CLI. Use the project's package runner:

```bash
# npm
npx shadcn@latest add @diceui/combobox

# pnpm
pnpm dlx shadcn@latest add @diceui/combobox

# bun
bunx --bun shadcn@latest add @diceui/combobox
```

This copies the component source into your project (typically under your components directory).

Some components are also available as npm packages for headless usage:
```bash
npm install @diceui/combobox
```

## Prerequisites

- A React project with [shadcn/ui](https://ui.shadcn.com/) configured
- Tailwind CSS v4+
- TypeScript

## Usage Pattern

DiceUI components use the compound component pattern. Each component has a root and named sub-parts:

```tsx
import {
  Combobox,
  ComboboxAnchor,
  ComboboxInput,
  ComboboxContent,
  ComboboxItem,
  ComboboxItemIndicator,
} from "@/components/ui/combobox";

export function Example() {
  return (
    <Combobox>
      <ComboboxAnchor>
        <ComboboxInput placeholder="Search..." />
      </ComboboxAnchor>
      <ComboboxContent>
        <ComboboxItem value="apple">
          <ComboboxItemIndicator />
          Apple
        </ComboboxItem>
      </ComboboxContent>
    </Combobox>
  );
}
```

## Available Components

46 components across interactive inputs, data display, layout, and navigation:

### Interactive Inputs
- **combobox** — Filterable dropdown with search, multi-select, async loading
- **tags-input** — Tag entry with validation, paste support, drag reorder
- **mention** — @mention input with user/entity suggestions
- **mask-input** — Input with format masks (dates, phones, etc.)
- **phone-input** — International phone number input with country selector
- **segmented-input** — OTP/verification code input
- **editable** — Inline editable text (click to edit)
- **color-picker** — Full color picker with swatches, formats, eye dropper
- **color-swatch** — Color swatch display/selector
- **rating** — Star/emoji rating input
- **time-picker** — Time selection input
- **angle-slider** — Circular angle/rotation slider
- **file-upload** — Drag-and-drop file upload with previews

### Data & Layout
- **data-table** — Full-featured data table (sorting, filtering, pagination)
- **data-grid** — Spreadsheet-style data grid
- **kanban** — Drag-and-drop kanban board
- **sortable** — Drag-and-drop sortable lists and grids
- **masonry** — Pinterest-style masonry layout
- **stack** — Flexible stack layout component
- **key-value** — Key-value pair display

### Feedback & Status
- **gauge** — Circular/linear gauge indicator
- **circular-progress** — Circular progress indicator
- **stat** — Statistic display with label and value
- **status** — Status indicator (dot + label)
- **fps** — FPS performance counter

### Navigation & Overlays
- **stepper** — Multi-step wizard/form flow
- **tour** — Product tour/onboarding walkthrough
- **scroll-spy** — Scroll-based navigation highlighting
- **speed-dial** — Floating action button with sub-actions
- **responsive-dialog** — Dialog on desktop, drawer on mobile
- **action-bar** — Floating action bar for selections
- **selection-toolbar** — Context toolbar for text/item selections

### Media & Display
- **media-player** — Audio/video player with controls
- **cropper** — Image cropping tool
- **compare-slider** — Before/after image comparison
- **qr-code** — QR code generator
- **marquee** — Scrolling/ticker content
- **timeline** — Vertical/horizontal timeline
- **relative-time-card** — "2 hours ago" time display
- **swap** — Animated content swap/toggle
- **scroller** — Smooth scroll container
- **avatar-group** — Stacked avatar display
- **badge-overflow** — Badge with overflow count (+3)
- **kbd** — Keyboard shortcut display
- **listbox** — Accessible listbox/select
- **checkbox-group** — Grouped checkboxes with select-all

## Utilities

9 utility components for common patterns:

- **client-only** — Render only on client (SSR-safe)
- **composition** — Component composition helpers
- **direction-provider** — RTL/LTR direction context
- **hitbox** — Expand click/touch targets
- **pending** — Pending/loading state management
- **portal** — Render into different DOM location
- **presence** — Mount/unmount with animation support
- **visually-hidden** — Screen-reader-only content
- **visually-hidden-input** — Hidden form input (for custom controls)

## Component Documentation

The `references/` folder contains detailed documentation for each component and utility, including:

- Full API reference with all props, sub-components, and types
- Data attributes and CSS variables for styling
- Keyboard shortcuts and accessibility info
- Usage examples and composition patterns

Read the relevant reference file before implementing a component to understand its full API surface.

## Customization

Since components are copied into your project, you can modify them freely:

- Edit the component source file directly
- Override styles with Tailwind classes or CSS variables
- Add/remove sub-components as needed
- Extend with additional props

Components use shadcn/ui's design tokens (`bg-primary`, `text-muted-foreground`, etc.) so they integrate seamlessly with your existing theme.

## Troubleshooting

### Component not found when installing
Make sure you're using the `@diceui/` prefix:
```bash
npx shadcn@latest add @diceui/combobox  # correct
npx shadcn@latest add combobox          # wrong - this is shadcn's combobox
```

### Styles not applying
Ensure your Tailwind CSS configuration includes the component directory in its content paths. DiceUI components use the same design tokens as shadcn/ui.

### Import path issues
After installation, components are in your local components directory. Check your `components.json` for the configured path (usually `@/components/ui/`).

# Timeline

A flexible timeline component for displaying chronological events with support for different orientations, RTL layouts, and visual states.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/timeline

```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

```tsx

  Timeline,
  TimelineItem,
  TimelineDot,
  TimelineConnector,
  TimelineContent,
  TimelineHeader,
  TimelineTitle,
  TimelineTime,
  TimelineDescription,
} from "@/components/ui/timeline";

<Timeline>
  <TimelineItem>
    <TimelineDot />
    <TimelineConnector />
    <TimelineContent>
      <TimelineHeader>
        <TimelineTitle />
        <TimelineTime />
      </TimelineHeader>
      <TimelineDescription />
    </TimelineContent>
  </TimelineItem>
</Timeline>
```

## Examples

### Horizontal Timeline

Display timeline events horizontally across the screen.


### RTL Timeline

Display timeline with right-to-left layout for RTL languages.


### Alternate Timeline

Display timeline events in an alternating pattern with content on both sides.


### Horizontal Alternate Timeline

Display timeline events horizontally with content alternating above and below.


### With Custom Dots

Add custom icons or content to the timeline dots using CSS variables.


## API Reference

### Timeline

The root container for timeline items.

> Props: `TimelineProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/timeline)

> CSS variables available — see [docs](https://diceui.com/docs/components/timeline)

### TimelineItem

A single timeline item containing content, marker, and connector.

> Props: `TimelineItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/timeline)

### TimelineDot

The visual marker/dot for a timeline item.

> Props: `TimelineDotProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/timeline)

> CSS variables available — see [docs](https://diceui.com/docs/components/timeline)

### TimelineConnector

The line connecting timeline items.

> Props: `TimelineConnectorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/timeline)

> CSS variables available — see [docs](https://diceui.com/docs/components/timeline)

### TimelineHeader

Container for the title and time of a timeline item.

> Props: `TimelineHeaderProps`

### TimelineTitle

The title/heading of a timeline item.

> Props: `TimelineTitleProps`

### TimelineDescription

The description/body text of a timeline item.

> Props: `TimelineDescriptionProps`

### TimelineContent

Container for the timeline item's content (header, description, etc.).

> Props: `TimelineContentProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/timeline)

### TimelineTime

A semantic time element for displaying dates/times.

> Props: `TimelineTimeProps`

## Features

### Flexible Orientations

The timeline supports both vertical and horizontal orientations. Use the `orientation` prop on `Timeline.Root` to switch between layouts.

### Alternate Variant

The timeline supports an alternate variant where content alternates on both sides of the timeline. Use the `variant="alternate"` prop on `Timeline.Root` to enable this layout. This works with both vertical and horizontal orientations:

- **Vertical alternate**: Content alternates left and right of the center line
- **Horizontal alternate**: Content alternates above and below the center line

```tsx
<Timeline.Root variant="alternate" orientation="horizontal">
  {/* Content alternates above and below */}
</Timeline.Root>
```

### RTL Support

The timeline fully supports right-to-left (RTL) layouts through the `dir` prop. When set to `"rtl"`, the timeline automatically flips its layout direction, making it ideal for RTL languages like Arabic, Hebrew, and Persian.

### Active Index

Control the visual state of timeline items using the `activeIndex` prop on the root component. Items before the active index will be marked as "completed", the item at the active index will be "active", and items after will be "pending".

```tsx
<Timeline.Root activeIndex={2}>
  <Timeline.Item>Step 1 - Completed</Timeline.Item>
  <Timeline.Item>Step 2 - Completed</Timeline.Item>
  <Timeline.Item>Step 3 - Active (index 2)</Timeline.Item>
  <Timeline.Item>Step 4 - Pending</Timeline.Item>
</Timeline.Root>
```

The `activeIndex` is zero-based, so `activeIndex={2}` makes the third item active.

### Custom Icons

Replace the default dot marker with custom icons or React components by passing children to `Timeline.Dot`, giving you full control over the visual appearance.

### Composition Pattern

Built with a composable API that gives you complete control over the structure and styling of your timeline. Mix and match components as needed.

## Accessibility

### ARIA Roles

The timeline uses ARIA roles and attributes for proper accessibility:

- Root uses `role="list"` and `aria-orientation` to represent an ordered list of events
- Each item uses `role="listitem"` for proper list semantics
- Active items use `aria-current="step"` to indicate current position in the timeline
- Semantic `<time>` elements with `dateTime` attribute for proper date representation
- Connectors are marked with `aria-hidden="true"` as they're purely decorative
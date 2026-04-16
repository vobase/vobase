# Status

A flexible status indicator component with animated ping effect and color variants for displaying system states, user presence, and service health.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/status
```

### Manual


  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  Status,
  StatusIndicator,
  StatusLabel,
} from "@/components/ui/status";

return (
  <Status variant="success">
    <StatusIndicator />
    <StatusLabel>Online</StatusLabel>
  </Status>
);
```

## Examples

### Variants

Status supports five color variants to represent different states.


### Text Only

Use status without the indicator for a simpler appearance.


### Service Status List

Display multiple status items in a list format, ideal for system health dashboards.


## API Reference

### Status

The main container component that provides the badge-style wrapper with color variants.

> Props: `StatusProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/status)

### StatusIndicator

An animated pulse indicator for the status.

> Props: `StatusIndicatorProps`

### StatusLabel

The text label for the status.

> Props: `StatusLabelProps`

## Accessibility

The Status component uses semantic HTML and follows best practices for accessibility:

- Uses `div` elements with proper ARIA attributes when needed
- Color is not the only means of conveying information—always include text labels
- Supports keyboard navigation when used with interactive elements via `asChild`

## Notes

- The animated ping effect uses Tailwind's built-in `animate-ping` utility for smooth performance
- Colors automatically adapt to dark mode
- The indicator animation runs continuously to draw attention to live status changes
- Use the `asChild` prop to render Status as a link or button for interactive use cases
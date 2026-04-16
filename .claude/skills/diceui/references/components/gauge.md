# Gauge

A customizable gauge component that displays values on circular or partial arcs, perfect for dashboards, metrics, and KPIs.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/gauge
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts and compose them together.

```tsx

  Gauge,
  GaugeIndicator,
  GaugeTrack,
  GaugeRange,
  GaugeValueText,
  GaugeLabel,
} from "@/components/ui/gauge";

return (
  <Gauge>
    <GaugeIndicator>
      <GaugeTrack />
      <GaugeRange />
    </GaugeIndicator>
    <GaugeValueText />
    <GaugeLabel>Label</GaugeLabel>
  </Gauge>
)
```

Or use the `Combined` component to get all the parts in one.

```tsx


<GaugeCombined label="Performance" />
```

## Examples

### Sizes

Different gauge sizes to fit various UI contexts.


### Colors

Different color themes for various use cases like system monitoring, health indicators, and status displays.


### Variants

Different arc configurations including semi-circle, three-quarter circle, and full circle gauges.


## Value Text Formatting

By default, the gauge displays the percentage value (0–100) based on `value`, `min`, and `max`. You can customize the format using the `getValueText` prop:

### Show Percentage
```tsx
<Gauge 
  value={85}
  getValueText={(value, min, max) => {
    const percentage = ((value - min) / (max - min)) * 100;
    return `${Math.round(percentage)}%`;
  }}
>
  {/* ... */}
</Gauge>
```

### Show Fraction
```tsx
<Gauge 
  value={75}
  max={100}
  getValueText={(value, min, max) => `${value}/${max}`}
>
  {/* ... */}
</Gauge>
```

### Custom Text
```tsx
<Gauge 
  value={75}
  getValueText={(value) => `${value} points`}
>
  {/* ... */}
</Gauge>
```

## Theming

The gauge component uses CSS `currentColor` for stroke colors, making it easy to theme using Tailwind's text utilities:

### Track Theming
```tsx
<GaugeTrack className="text-blue-200 dark:text-blue-900" />
```

### Range Theming
```tsx
<GaugeRange className="text-blue-500" />
```

### Value Text Theming
```tsx
<GaugeValueText className="text-blue-700 dark:text-blue-300" />
```

### Label Theming
```tsx
<GaugeLabel className="text-blue-600" />
```

## API Reference

### Gauge

The main container component for the gauge.

> Props: `GaugeProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/gauge)

### GaugeIndicator

The SVG container that holds the gauge arc paths.

> Props: `GaugeIndicatorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/gauge)

### GaugeTrack

The background arc that represents the full range of possible values.

> Props: `GaugeTrackProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/gauge)

### GaugeRange

The portion of the arc that represents the current gauge value with smooth animations.

> Props: `GaugeRangeProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/gauge)

### GaugeValueText

The text element that displays the current gauge value or custom content. Automatically centers within the arc's visual bounds.

> Props: `GaugeValueTextProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/gauge)

### GaugeLabel

An optional label element that displays below the gauge.

> Props: `GaugeLabelProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/gauge)

### GaugeCombined

The combined component that includes all the parts.

> Props: `GaugeProps`

## Accessibility

### Screen Reader Support

- Uses the `meter` role for proper screen reader identification
- Provides `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext` attributes
- Supports `aria-labelledby` when a label prop is provided
- Supports indeterminate state by omitting `aria-valuenow` when value is null

## Notes

- The component automatically handles indeterminate states when `value` is `null` or `undefined`
- Gauge values are automatically clamped to the valid range between `min` and `max`
- Invalid `max` or `value` props will log console errors and use fallback values
- Supports full circles (360°) by automatically splitting into two semi-circles for proper SVG rendering
- Value text automatically centers within the arc's visual bounds for both full and partial circles
- The gauge range uses `stroke-dashoffset` animations for smooth, performant filling effects
- All stroke colors use `currentColor` by default, making them responsive to text color changes
- Default angles are 0° (start) to 360° (end) for a full circle gauge
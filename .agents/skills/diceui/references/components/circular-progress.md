# Circular Progress

A circular progress indicator that displays completion progress in a ring format with support for indeterminate states.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/circular-progress
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the following code into your project.

    
  
  
    Add the following CSS animations to your `globals.css` file:

    ```css
    @theme {
      --animate-spin-around: spin-around 0.8s linear infinite;

      @keyframes spin-around {
        0% {
          transform: rotate(-90deg);
        }
        100% {
          transform: rotate(270deg);
        }
      }
    }
    ```
  


## Layout

Import the parts and compose them together.

```tsx

  CircularProgress,
  CircularProgressIndicator,
  CircularProgressTrack,
  CircularProgressRange,
  CircularProgressValueText,
} from "@/components/ui/circular-progress";

return (
  <CircularProgress>
    <CircularProgressIndicator>
      <CircularProgressTrack />
      <CircularProgressRange />
    </CircularProgressIndicator>
    <CircularProgressValueText />
  </CircularProgress>
)
```

Or use the `Combined` component to get all the parts in one.

```tsx


<CircularProgressCombined />
```

## Examples

### Interactive Demo

A circular progress with interactive controls and simulated upload progress.


### Colors

Different color themes using Tailwind CSS stroke and text utilities to customize the track, range, and value text colors.


## Theming

The circular progress component uses CSS `currentColor` for stroke colors, making it easy to theme using Tailwind's text or stroke utilities:

### Track Theming
```tsx
<CircularProgressTrack className="text-green-200 dark:text-green-900" />
```

### Range Theming
```tsx
<CircularProgressRange className="text-green-500" />
```

### Value Text Theming
```tsx
<CircularProgressValueText className="text-green-700 dark:text-green-300" />
```

### Custom Stroke Styles
You can also use Tailwind's stroke utilities directly:
```tsx
<CircularProgressTrack className="stroke-blue-200" />
<CircularProgressRange className="stroke-blue-500" />
```

## API Reference

### CircularProgress

The main container component for the circular progress.

> Props: `CircularProgressProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/circular-progress)

### CircularProgressIndicator

The SVG container that holds the circular progress tracks and ranges.

> Props: `CircularProgressIndicatorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/circular-progress)

### CircularProgressTrack

The background circle that represents the full range of possible values.

> Props: `CircularProgressTrackProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/circular-progress)

### CircularProgressRange

The portion of the circle that represents the current progress value.

> Props: `CircularProgressRangeProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/circular-progress)

### CircularProgressValueText

The text element that displays the current progress value or custom content.

> Props: `CircularProgressValueTextProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/circular-progress)


### CircularProgressCombined

The combined component that includes all the parts.

> Props: `CircularProgressProps`

## Accessibility

### Screen Reader Support

- Uses the `progressbar` role for proper screen reader identification
- Provides `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext` attributes
- Supports indeterminate state by omitting `aria-valuenow` when value is null

## Notes

- The component automatically handles indeterminate states when `value` is `null` or `undefined`
- Progress values are automatically clamped to the valid range between `min` and `max`
- Invalid `max` or `value` props will log console errors and use fallback values
- The indeterminate animation uses CSS custom properties and can be customized via the `--animate-spin-around` variable
- All stroke colors use `currentColor` by default, making them responsive to text color changes
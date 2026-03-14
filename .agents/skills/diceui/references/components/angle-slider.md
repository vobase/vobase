# Angle Slider

An interactive circular slider for selecting angles with support for single values and ranges.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/angle-slider
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the visually hidden input component into your `components/visually-hidden-input.tsx` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts and compose them together.

```tsx

  AngleSlider,
  AngleSliderRange,
  AngleSliderThumb,
  AngleSliderTrack,
  AngleSliderValue,
} from "@/components/ui/angle-slider";

return (
  <AngleSlider>
    <AngleSliderTrack>
      <AngleSliderRange />
    </AngleSliderTrack>
    <AngleSliderThumb />
    <AngleSliderValue />
  </AngleSlider>
)
```

## Examples

### **Controlled** State

A slider with controlled state management and custom actions.


### Range Selection

Use multiple thumbs to create angle ranges with minimum step constraints.


### Themes

Slider variants with different themes.


### With Form

Integrate the angle slider with form validation and submission.


## Theming

You can customize the appearance by targeting specific components:

### Track Theming
Use `[&>[data-slot='angle-slider-track-rail']]` to style the background track:
```tsx
<AngleSliderTrack className="[&>[data-slot='angle-slider-track-rail']]:stroke-green-100" />
```

### Range Theming
```tsx
<AngleSliderRange className="stroke-green-500" />
```

### Thumb Theming
```tsx
<AngleSliderThumb className="border-green-500 bg-green-50 ring-green-500/50" />
```

### Value Theming
```tsx
<AngleSliderValue className="text-green-600 dark:text-green-400" />
```

## API Reference

### AngleSlider

The main container component for the angle slider.

> Props: `AngleSliderProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/angle-slider)

### AngleSliderTrack

The circular track that represents the full range of possible values.

> Props: `AngleSliderTrackProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/angle-slider)

### AngleSliderRange

The portion of the track that represents the selected range.

> Props: `AngleSliderRangeProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/angle-slider)

### AngleSliderThumb

The draggable handle for selecting values.

> Props: `AngleSliderThumbProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/angle-slider)

### AngleSliderValue

Displays the current value(s) with customizable formatting.

> Props: `AngleSliderValueProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/angle-slider)

## Accessibility

The angle slider component includes comprehensive accessibility features:

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/angle-slider)

## Features

- Optimized for touch interactions on mobile devices
- Smooth dragging experience with proper pointer handling
- Full right-to-left language support
- Comprehensive keyboard navigation and screen reader support
- Angle ranges with minimum step constraints with multiple thumbs
- Controlled and uncontrolled state management
# Segmented Input

A group of connected input fields that appear as a single segmented visual unit.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/segmented-input
```

### Manual


  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx


return (
  <SegmentedInput.Root>
    <SegmentedInput.Item />
  </SegmentedInput.Root>
)
```

## Examples

### Form Input

Use segmented inputs for structured form data like phone numbers or addresses.


### RGB Color Input

Create color input controls using segmented inputs for RGB values.


### Vertical Layout

Display segmented inputs in a vertical orientation.


## API Reference

### SegmentedInput

The main segmented input container.

> Props: `SegmentedInputProps`

### SegmentedInputItem

Individual input items within the segmented input.

> Props: `SegmentedInputItemProps`

## Accessibility

The SegmentedInput component follows standard web accessibility practices. Users navigate between inputs using Tab and Shift+Tab keys, which is the expected behavior for form controls.

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/segmented-input)
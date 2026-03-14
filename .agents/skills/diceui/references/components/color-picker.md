# Color Picker

A color picker component that allows users to select colors using various input methods.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/color-picker

```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-slider @radix-ui/react-slot lucide-react
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    

  
   
    Copy and paste the visually hidden input component into your `components/visually-hidden-input.tsx` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  ColorPicker,
  ColorPickerAlphaSlider,
  ColorPickerArea,
  ColorPickerContent,
  ColorPickerEyeDropper,
  ColorPickerFormatSelect,
  ColorPickerHueSlider,
  ColorPickerInput,
  ColorPickerSwatch,
  ColorPickerTrigger,
} from "@/components/ui/color-picker";

return (
  <ColorPicker>
    <ColorPickerTrigger>
      <ColorPickerSwatch />
    </ColorPickerTrigger>
    <ColorPickerContent>
      <ColorPickerArea />
      <ColorPickerEyeDropper />
      <ColorPickerHueSlider />
      <ColorPickerAlphaSlider />
      <ColorPickerFormatSelect />
      <ColorPickerInput />
    </ColorPickerContent>
  </ColorPicker>
)
```

## Examples

### Inline Color Picker

Use the `inline` prop to render the color picker inline instead of in a popover.


### Controlled State

A color picker with controlled state management.


### With Form

A color picker with form integration.


## API Reference

### ColorPicker

The main container component for the color picker.

> Props: `ColorPickerProps`

### ColorPickerTrigger

The trigger button that opens the color picker popover.

> Props: `ColorPickerTriggerProps`

### ColorPickerContent

The content container for the color picker components.

> Props: `ColorPickerContentProps`

### ColorPickerArea

The 2D color area for selecting hue and saturation.

> Props: `ColorPickerAreaProps`

### ColorPickerSwatch

A color swatch that displays the current color.

> Props: `ColorPickerSwatchProps`

### ColorPickerHueSlider

A slider for adjusting the hue value of the color.

> Props: `ColorPickerHueSliderProps`

### ColorPickerAlphaSlider

A slider for adjusting the alpha (transparency) value of the color.

> Props: `ColorPickerAlphaSliderProps`

### ColorPickerEyeDropper

A button that activates the browser's native eye dropper tool to pick colors from the screen.

> Props: `ColorPickerEyeDropperProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/color-picker)

**Note:** The EyeDropper component only renders when the browser supports the native EyeDropper API. It will return `null` in unsupported browsers.

### ColorPickerFormatSelect

A select dropdown for choosing the color format (hex, rgb, hsl, hsb).

> Props: `ColorPickerFormatSelectProps`

### ColorPickerInput

An input field that displays and allows editing of the color value in the selected format.

> Props: `ColorPickerInputProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/color-picker)

## Browser Support

### EyeDropper API

The EyeDropper component requires browser support for the native EyeDropper API:

- **Chrome/Edge**: Supported from version 95+
- **Firefox**: Not supported
- **Safari**: Not supported

The component gracefully handles unsupported browsers by not rendering the eye dropper button.

## Color Formats

The color picker supports the following color formats:

- **HEX**: Hexadecimal color notation (e.g., `#3b82f6`)
- **RGB**: Red, Green, Blue color notation (e.g., `rgb(59, 130, 246)`)
- **HSL**: Hue, Saturation, Lightness color notation (e.g., `hsl(217, 91%, 60%)`)
- **HSB**: Hue, Saturation, Brightness color notation (e.g., `hsb(217, 76%, 96%)`)

All formats support alpha channel for transparency when not using the `withoutAlpha` prop.
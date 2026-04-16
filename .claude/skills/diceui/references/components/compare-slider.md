# Compare Slider

An interactive before/after comparison slider for comparing two elements side by side.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/compare-slider
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot lucide-react
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  CompareSlider,
  CompareSliderBefore,
  CompareSliderAfter,
  CompareSliderHandle,
} from "@/components/ui/compare-slider";

return (
  <CompareSlider>
    <CompareSliderBefore />
    <CompareSliderAfter />
    <CompareSliderHandle />
  </CompareSlider>
)
```

## Examples

### Controlled State

A compare slider with external controls for the slider position.


### Vertical Orientation

A compare slider with vertical orientation, perfect for comparing tall images or content.


### Customization

Compare slider with custom handle, labels, and vertical orientation.


## API Reference

### CompareSlider

The root container for the compare slider component.

> Props: `CompareSliderProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/compare-slider)

### CompareSliderBefore

The container for the "before" content that appears on the left (or top in vertical mode).

> Props: `CompareSliderBeforeProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/compare-slider)

### CompareSliderAfter

The container for the "after" content that appears on the right (or bottom in vertical mode).

> Props: `CompareSliderAfterProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/compare-slider)

### CompareSliderHandle

The draggable handle that controls the comparison position.

> Props: `CompareSliderHandleProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/compare-slider)

### CompareSliderLabel

Custom labels that can be positioned on either side of the comparison.

> Props: `CompareSliderLabelProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/compare-slider)

### Mouse and Touch Interactions

- **Drag**: Click and drag the handle to adjust the comparison position
- **Click**: Click anywhere on the slider container to jump to that position
- **Touch**: Full touch support for mobile devices

## Advanced Usage

### Custom Content Types

The compare slider works with any React content, not just images:

```tsx
<CompareSlider>
  <CompareSliderBefore>
    <div className="flex items-center justify-center bg-blue-500">
      <p>Old Design</p>
    </div>
  </CompareSliderBefore>
  <CompareSliderAfter>
    <div className="flex items-center justify-center bg-green-500">
      <p>New Design</p>
    </div>
  </CompareSliderAfter>
  <CompareSliderHandle />
</CompareSlider>
```

### Vertical Orientation

Use vertical orientation for comparing content that works better in a vertical layout. The slider handle moves vertically, and the "before" content appears on top while "after" content appears on bottom.

```tsx
<CompareSlider orientation="vertical" className="h-[600px]">
  <CompareSliderBefore>
    {/* Top content */}
  </CompareSliderBefore>
  <CompareSliderAfter>
    {/* Bottom content */}
  </CompareSliderAfter>
  <CompareSliderHandle />
</CompareSlider>
```

See the [Vertical Orientation example](#vertical-orientation) for a complete demo.

### Custom Labels

Add custom labels to identify each side:

```tsx
<CompareSlider>
  <CompareSliderBefore label="Original">
    {/* Content */}
  </CompareSliderBefore>
  <CompareSliderAfter label="Enhanced">
    {/* Content */}
  </CompareSliderAfter>
  <CompareSliderHandle />
</CompareSlider>
```

Or use the `CompareSliderLabel` component for more control:

```tsx
<CompareSlider>
  <CompareSliderBefore>
    {/* Content */}
  </CompareSliderBefore>
  <CompareSliderAfter>
    {/* Content */}
  </CompareSliderAfter>
  <CompareSliderHandle />
  <CompareSliderLabel side="before" className="bg-blue-500/90 text-white">
    Original
  </CompareSliderLabel>
  <CompareSliderLabel side="after" className="bg-green-500/90 text-white">
    Enhanced
  </CompareSliderLabel>
</CompareSlider>
```

## Browser Support

### Core Features

All core comparison features work in modern browsers:

- **Chrome/Edge**: Full support
- **Firefox**: Full support  
- **Safari**: Full support (iOS 13+)

### Touch Gestures

Touch interactions require modern touch APIs:

- **iOS Safari**: Supported from iOS 13+
- **Chrome Mobile**: Full support
- **Firefox Mobile**: Full support

## Troubleshooting

### Content Overflow

Ensure your content is properly contained within the slider:

```tsx
<CompareSlider className="h-[400px] overflow-hidden">
  <CompareSliderBefore>
    <img className="size-full object-cover" src="..." />
  </CompareSliderBefore>
  {/* ... */}
</CompareSlider>
```

### Performance with Large Images

For large images, consider:

1. Using optimized image formats (WebP, AVIF)
2. Lazy loading images
3. Using appropriate image sizes for the display size
4. Implementing image preloading for smoother transitions

### Mobile Considerations

On mobile devices:

- Ensure touch targets are adequately sized
- Test on various screen sizes
- Consider using vertical orientation for better mobile UX
- Ensure content is responsive and scales appropriately

## Credits

- [Samuel Ferrara](https://unsplash.com/@samferrara?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText) on [Unsplash](https://unsplash.com/photos/aerial-photo-of-foggy-mountains-1527pjeb6jg?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText) - For the demo images used in the examples.
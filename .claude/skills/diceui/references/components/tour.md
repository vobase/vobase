# Tour

A guided tour component that highlights elements and provides step-by-step instructions to help users learn about your application.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/tour

```

### Manual


  
     Install the following dependencies:

     ```package-install
     @floating-ui/react-dom @radix-ui/react-slot lucide-react
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  Tour,
  TourPortal,
  TourSpotlight,
  TourSpotlightRing,
  TourStep,
  TourArrow,
  TourClose,
  TourHeader,
  TourTitle,
  TourDescription,
  TourFooter,
  TourStepCounter,
  TourPrev,
  TourNext,
  TourSkip,
} from "@/components/ui/tour";

return (
  <Tour>
    <TourPortal>
      <TourSpotlight />
      <TourSpotlightRing />
      <TourStep>
        <TourArrow />
        <TourClose />
        <TourHeader>
          <TourTitle />
          <TourDescription />
        </TourHeader>
        <TourFooter>
          <TourStepCounter />
          <TourPrev />
          <TourNext />
          <TourSkip />
        </TourFooter>
      </TourStep>
    </TourPortal>
  </Tour>
)
```

## Examples

### Controlled

A tour with controlled state management, allowing external control of the current step.


### Custom Spotlight Styling

You can customize the appearance of the spotlighted element using the `SpotlightRing` component:

```tsx
<Tour.Root open={open} onOpenChange={setOpen}>
  <Tour.Portal>
    <Tour.Spotlight />
    {/* Border style */}
    <Tour.SpotlightRing className="rounded-lg border-2 border-primary" />
    {/* Ring with offset */}
    <Tour.SpotlightRing className="rounded-xl ring-2 ring-blue-500 ring-offset-2" />
    {/* Glowing effect */}
    <Tour.SpotlightRing className="rounded-lg shadow-lg shadow-primary/50" />
    {/* Animated pulse */}
    <Tour.SpotlightRing className="rounded-lg border-2 border-primary animate-pulse" />
    <Tour.Step target="#element">{/* ... */}</Tour.Step>
  </Tour.Portal>
</Tour.Root>
```

### Global Offset Control

Set default spacing for all steps and override per step:

```tsx
<Tour.Root
  open={open}
  onOpenChange={setOpen}
  sideOffset={16}      // Global default: 16px gap
  alignOffset={0}      // Global alignment offset
>
  <Tour.Portal>
    <Tour.Spotlight />
    <Tour.SpotlightRing />
    
    {/* Uses global sideOffset={16} */}
    <Tour.Step target="#step-1" side="bottom">
      <Tour.Header>
        <Tour.Title>Step 1</Tour.Title>
      </Tour.Header>
    </Tour.Step>
    
    {/* Overrides with custom sideOffset={32} */}
    <Tour.Step target="#step-2" side="top" sideOffset={32}>
      <Tour.Header>
        <Tour.Title>Step 2 - Larger Gap</Tour.Title>
      </Tour.Header>
    </Tour.Step>
  </Tour.Portal>
</Tour.Root>
```

## API Reference

### Tour

The main container component for the tour that manages state and provides context.

> Props: `TourProps`


### TourSpotlight

The spotlight backdrop that dims the page and highlights the target element with a cutout effect.

> Props: `TourSpotlightProps`

<DataAttributesTable
  attributes={[
    {
      title: "[data-state]",
      value: ["open", "closed"],
    },
  ]}
/>

### TourSpotlightRing

A visual ring/border element that wraps around the spotlighted target element. Use this to add custom styling like borders, shadows, or animations to the highlighted area.

> Props: `TourSpotlightRingProps`

<DataAttributesTable
  attributes={[
    {
      title: "[data-state]",
      value: ["open", "closed"],
    },
  ]}
/>

### TourStep

A single step in the tour that targets a specific element on the page.

> Props: `TourStepProps`

<DataAttributesTable
  attributes={[
    {
      title: "[data-side]",
      value: ["top", "right", "bottom", "left"],
    },
    {
      title: "[data-align]",
      value: ["start", "center", "end"],
    },
  ]}
/>

### TourClose

Button to close the entire tour.

> Props: `TourCloseProps`

### TourHeader

Container for the tour step's title and description.

> Props: `TourHeaderProps`

### TourTitle

The title of the current tour step.

> Props: `TourTitleProps`

### TourDescription

The description text for the current tour step.

> Props: `TourDescriptionProps`

### TourFooter

Container for tour navigation controls and step counter.

> Props: `TourFooterProps`

### TourStepCounter

Displays the current step number and total steps.

> Props: `TourStepCounterProps`

### TourPrev

Button to navigate to the previous step.

> Props: `TourPrevProps`

### TourNext

Button to navigate to the next step or complete the tour.

> Props: `TourNextProps`

### TourSkip

Button to skip the entire tour.

> Props: `TourSkipProps`

### TourArrow

An optional arrow element that points to the target element.

> Props: `TourArrowProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/tour)

## Credits

- [Radix UI Dismissable Layer](https://github.com/radix-ui/primitives/blob/main/packages/react/dismissable-layer/src/dismissable-layer.tsx) - For the pointer down outside and interact outside event handling patterns.
- [Radix UI Focus Guard](https://github.com/radix-ui/primitives/blob/main/packages/react/focus-guards/src/focus-guards.tsx) - For the focus guard implementation.
- [Radix UI Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) - For the focus trap and auto-focus management patterns.
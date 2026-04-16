# Responsive Dialog

A dialog component that automatically switches between a centered dialog on desktop and a bottom drawer on mobile.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/responsive-dialog
```

### Manual


  
     Install the following dependencies:

     ```package-install
     vaul
     ```
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
    
  
  
    Copy and paste the dialog and drawer components into your project.

    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";

<ResponsiveDialog>
  <ResponsiveDialogTrigger />
  <ResponsiveDialogContent>
    <ResponsiveDialogHeader>
      <ResponsiveDialogTitle />
      <ResponsiveDialogDescription />
    </ResponsiveDialogHeader>
    <ResponsiveDialogFooter />
  </ResponsiveDialogContent>
</ResponsiveDialog>
```

## Examples

### Confirmation Dialog

Use the responsive dialog to confirm destructive actions like deleting items.


### Variant Styling

Each component exposes a `data-variant` attribute that can be used to apply different styles based on whether the dialog or drawer is rendered.

```tsx
<ResponsiveDialogContent className="data-[variant=drawer]:pb-8 data-[variant=dialog]:max-w-md">
  {/* content */}
</ResponsiveDialogContent>

<ResponsiveDialogFooter className="data-[variant=drawer]:flex-col data-[variant=dialog]:flex-row">
  {/* buttons */}
</ResponsiveDialogFooter>
```

## API Reference

### ResponsiveDialog

The root component that manages the dialog/drawer state.

> Props: `ResponsiveDialogProps`

### ResponsiveDialogTrigger

The button that opens the dialog/drawer.

> Props: `ResponsiveDialogTriggerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

### ResponsiveDialogContent

The content container for the dialog/drawer.

> Props: `ResponsiveDialogContentProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

### ResponsiveDialogHeader

The header section of the dialog/drawer.

> Props: `ResponsiveDialogHeaderProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

### ResponsiveDialogFooter

The footer section of the dialog/drawer.

> Props: `ResponsiveDialogFooterProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

### ResponsiveDialogTitle

The title of the dialog/drawer.

> Props: `ResponsiveDialogTitleProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

### ResponsiveDialogDescription

The description of the dialog/drawer.

> Props: `ResponsiveDialogDescriptionProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

### ResponsiveDialogClose

The close button for the dialog/drawer.

> Props: `ResponsiveDialogCloseProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

### ResponsiveDialogOverlay

The overlay behind the dialog/drawer.

> Props: `ResponsiveDialogOverlayProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

### ResponsiveDialogPortal

The portal container for the dialog/drawer.

> Props: `ResponsiveDialogPortalProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/responsive-dialog)

## Accessibility

Adheres to the [Dialog WAI-ARIA design pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/responsive-dialog)
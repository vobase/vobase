# Selection Toolbar

A floating toolbar that appears on text selection with formatting and utility actions.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/selection-toolbar
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @floating-ui/react-dom @radix-ui/react-slot
     ```
  
  
    Copy and paste the following utility into your `lib` directory.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  SelectionToolbar,
  SelectionToolbarItem,
  SelectionToolbarSeparator,
} from "@/components/ui/selection-toolbar";

return (
  <SelectionToolbar>
    <SelectionToolbarItem />
    <SelectionToolbarSeparator />
  </SelectionToolbar>
)
```

## Examples

### Selection Info

Track selection information with the `onSelectionChange` callback to display word count, character count, and other metrics.


## API Reference

### SelectionToolbar

The root component that manages the toolbar's visibility and positioning.

> Props: `SelectionToolbarProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/selection-toolbar)

> CSS variables available — see [docs](https://diceui.com/docs/components/selection-toolbar)

### SelectionToolbarItem

An actionable item within the toolbar, typically containing an icon.

> Props: `SelectionToolbarItemProps`

### SelectionToolbarSeparator

A visual separator between toolbar items.

> Props: `SelectionToolbarSeparatorProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/selection-toolbar)
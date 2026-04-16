# Listbox

A component for creating keyboard-navigable selection lists and grids.

## Installation

```package-install
@diceui/listbox
```

## Installation with shadcn/ui

### CLI

```package-install
npx shadcn@latest add @diceui/listbox
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/listbox
     ```
  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  ListboxRoot,
  ListboxGroup,
  ListboxGroupLabel,
  ListboxItem,
  ListboxItemIndicator,
} from "@diceui/listbox"

return (
  <ListboxRoot>
    <ListboxGroup>
      <ListboxGroupLabel/>
      <ListboxItem >
        <ListboxItemIndicator />
      </ListboxItem>
    </ListboxGroup>
  </ListboxRoot>
)
```

## Examples

### Horizontal Orientation

Set `orientation="horizontal"` to create a horizontally navigable list.


### Grid Layout

For grid layouts, use `orientation="mixed"` to enable navigation in both directions. 
Use CSS Grid to arrange the items in a grid structure. In grid layouts, 
arrow keys will navigate accordingly:

- Up/Down: Navigates within a column
- Left/Right: Navigates within a row


### Grouped Items

Group items together to create a list of related options.


## API Reference

### Listbox

The root component for creating listboxes.

> Props: `RootProps`

### ListboxGroup

A group of items inside the selectable list.

> Props: `GroupProps`

### ListboxGroupLabel

A label for the group of items.

> Props: `GroupLabelProps`

### ListboxItem

An item inside the selectable list.

> Props: `ItemProps`

### ListboxItemIndicator

A visual indicator that shows when the item is selected.

> Props: `ItemIndicatorProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/listbox)
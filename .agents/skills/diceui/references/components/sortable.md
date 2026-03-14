# Sortable

A drag and drop sortable component for reordering items.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/sortable

```

### Manual


  
     Install the following dependencies:

     ```package-install
     @dnd-kit/core @dnd-kit/modifiers @dnd-kit/sortable @dnd-kit/utilities @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    

  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from "@/components/ui/sortable";

return (
  <Sortable>
    <SortableContent>
      <SortableItem >
        <SortableItemHandle />
      </SortableItem>
      <SortableItem />
    </SortableContent>
    <SortableOverlay />
  </Sortable>
)
```

## Usage

### With Primitive Values

When using primitive arrays (strings, numbers), the `getItemValue` prop is optional. The component will automatically use the item itself as the unique identifier.

```tsx
const [items, setItems] = React.useState(["Item 1", "Item 2", "Item 3"]);

<Sortable value={items} onValueChange={setItems}>
  <SortableContent>
    {items.map((item) => (
      <SortableItem key={item} value={item}>
        {item}
      </SortableItem>
    ))}
  </SortableContent>
</Sortable>
```

### With Object Arrays

When using object arrays, the `getItemValue` prop is required to extract a unique identifier from each item.

```tsx
const [items, setItems] = React.useState([
  { id: 1, name: "Item 1" },
  { id: 2, name: "Item 2" },
]);

<Sortable
  value={items}
  onValueChange={setItems}
  getItemValue={(item) => item.id}
>
  <SortableContent>
    {items.map((item) => (
      <SortableItem key={item.id} value={item.id}>
        {item.name}
      </SortableItem>
    ))}
  </SortableContent>
</Sortable>
```

## Examples

### With Dynamic Overlay

Display a dynamic overlay when an item is being dragged.


### With Handle

Use `ItemHandle` as a drag handle for sortable items.


### With Primitive Values

Use an array of primitives (string or number) instead of objects for sorting.


## API Reference

### Sortable

The main container component for sortable functionality.

> Props: `SortableProps`

### SortableContent

Container for sortable items. Multiple `SortableContent` components can be used within a `Sortable` component.

> Props: `SortableContentProps`

### SortableItem

Individual sortable item component.

> Props: `SortableItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/sortable)

### SortableItemHandle

A button component that acts as a drag handle for sortable items.

> Props: `SortableItemHandleProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/sortable)

The component extends the base `Button` component and adds the following styles:

- `select-none` for pointer events
- `cursor-grab` when not dragging (unless `flatCursor` is true)
- `cursor-grabbing` when dragging (unless `flatCursor` is true)
- `cursor-default` when `flatCursor` is true

### Overlay

The overlay component that appears when an item is being dragged.

> Props: `SortableOverlayProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/sortable)
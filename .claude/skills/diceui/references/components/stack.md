# Stack

A component that displays items in a stacked layout with hover expansion effects, similar to Sonner toast stacking.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/stack

```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the following code into your project.

    
  


## Layout

```tsx


<Stack.Root>
  <Stack.Item />
</Stack.Root>
```

## Examples

### Without Expansion

Disable the hover expansion effect for a static stack.


### Different Sides

Stack items from different sides using the `side` prop.


## API Reference

### Stack.Root

The main container component that manages layout and hover interactions.

> Props: `StackProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stack)

### Stack.Item

Individual items within the stack. These are automatically positioned and animated.

> Props: `StackItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stack)

## Features

- **Hover Expansion**: Items expand on hover to reveal all stacked items
- **Customizable**: Control visible items, gap, offset, and scale factor
- **Smooth Animations**: Elegant CSS transitions for all interactions
- **Flexible Styling**: Works with any content and styling approach
- **Accessibility**: Proper data attributes and semantic HTML

## Usage Notes

- The stack uses absolute positioning for items, ensure the parent container has enough space
- Use the `visibleItems` prop to control how many items are visible in the collapsed state
- The `scaleFactor` prop determines how much each subsequent item shrinks (0.05 = 5% smaller)
- Set `expandOnHover={false}` to disable the expansion effect
- All items beyond `visibleItems` will have reduced opacity and be non-interactive when collapsed

## Credits

- [Emil Kowalski](https://emilkowal.ski/) - For the [Sonner](https://github.com/emilkowalski/sonner) toast library.
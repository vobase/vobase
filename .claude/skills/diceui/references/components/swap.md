# Swap

A component that swaps between two states with click or hover activation modes.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/swap
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx


return (
  <Swap>
    <SwapOn />
    <SwapOff />
  </Swap>
)
```

## Examples

### Animations

The swap component supports 4 different animation types: fade, rotate, flip, and scale.


## API Reference

### Swap

The main container component for swap functionality.

> Props: `SwapProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/swap)

### SwapOn

The content shown when the swap is in the swapped state.

> Props: `SwapOnProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/swap)

### SwapOff

The content shown when the swap is in the default state.

> Props: `SwapOffProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/swap)

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/swap)
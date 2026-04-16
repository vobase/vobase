# Action Bar

A floating action bar that appears at the bottom or top of the viewport to display contextual actions for selected items.

## Installation

### CLI

```package-install
npx shadcn@latest add "@diceui/action-bar"

```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot @radix-ui/react-direction
     ```
  
  
    Copy and paste the portal component into your `components/portal.tsx` file.

    
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

```tsx

  ActionBar,
  ActionBarSelection,
  ActionBarSeparator,
  ActionBarGroup,
  ActionBarItem,
  ActionBarClose,
} from "@/components/ui/action-bar";

return (
  <ActionBar>
    <ActionBarSelection />
    <ActionBarSeparator />
    <ActionBarGroup>
      <ActionBarItem />
      <ActionBarItem />
    </ActionBarGroup>
    <ActionBarClose />
  </ActionBar>
);
```

## Examples

### Position

Use the `side` and `align` props to control where the action bar appears.


## API Reference

### ActionBar

The root component that controls the visibility and position of the action bar. Has `role="toolbar"` for accessibility.

> Props: `ActionBarProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/action-bar)

### ActionBarSelection

Displays selection information, typically used to show how many items are selected.

> Props: `ActionBarSelectionProps`

### ActionBarGroup

A container for action items that implements roving focus management. Items within a group can be navigated using arrow keys, forming a single tab stop. See [Keyboard Interactions](#keyboard-interactions) for full details.

> Props: `ActionBarGroupProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/action-bar)

### ActionBarItem

An interactive button item within the action bar. When used inside a `Group`, participates in roving focus navigation.

> Props: `ActionBarItemProps`

### ActionBarClose

A button that closes the action bar by calling the `onOpenChange` callback with `false`. The close button has its own tab stop, separate from the group's roving focus.

> Props: `ActionBarCloseProps`

### ActionBarSeparator

A visual separator between action bar items.

> Props: `ActionBarSeparatorProps`


## Accessibility

### Keyboard Interactions

The action bar follows the [WAI-ARIA Toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) for keyboard navigation.

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/action-bar)
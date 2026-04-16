# Pending

A utility component that disables interactions, maintains keyboard focus, and ensures proper accessibility for buttons, forms, links, switches, and any interactive element while they are pending.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/pending
```

### Manual


  
    Copy and paste the following code into your project.

    
  


## Layout

Import the utility and use it with your interactive elements.

```tsx


// Using the hook
function SubmitButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { pendingProps, isPending } = usePending({ isPending: isSubmitting });

  return <Button {...pendingProps}>Submit</Button>;
}

// Using the wrapper component
function SubmitButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Pending isPending={isSubmitting}>
      <Button>Submit</Button>
    </Pending>
  );
}
```

## Examples

### Wrapper Component

Use the `Pending` wrapper component to easily apply pending state to any interactive element using Radix Slot.


### Form with Pending State

Handle form submissions with proper pending state management and user feedback.


### Navigation Links

Apply pending states to links during async navigation or route transitions.


### Toggle Switches

Show pending states on switches that save settings to an API or perform async updates.


## API Reference

### usePending

A hook that manages pending state for interactive elements. Returns props to spread on your element and the current pending state.

> Props: `UsePendingOptions`

#### Returns

> Props: `UsePendingReturn`

### Pending

A wrapper component that applies pending state behavior to its child using Radix Slot.

> Props: `PendingProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/pending)

## Accessibility

The Pending utility follows best practices for accessible pending states:

- Uses `aria-busy="true"` to indicate loading/pending state to screen readers
- Uses `aria-disabled="true"` to indicate the element is not currently interactive
- Maintains focus ability—users can still Tab to the element
- Prevents all interaction events (click, pointer, keyboard) when pending
- Screen readers announce the changed button content (e.g., "Submitting...")
- Provides `data-pending` attribute for custom styling

## Use Cases

The Pending utility works with **any interactive element**, not just buttons:

- **Buttons** - Form submissions, actions
- **Links** - Navigation with async route transitions
- **Cards** - Clickable cards that load content
- **Menu Items** - Actions like export, sync, archive
- **Switches/Toggles** - Settings that save to an API
- **Form Fields** - Inputs with async validation
- **Tabs** - Tab switches that load content
- **Select Options** - Dropdowns with async actions
- **Icon Buttons** - Icon-only interactive elements
- **List Items** - Navigation items in sidebars

## Notes

- **Choose your API**: Use the `usePending` hook for more control, or the `Pending` wrapper for convenience
- **Focus management**: Elements remain focusable but don't respond to interactions when pending
- **Event prevention**: All pointer and keyboard events are prevented during pending state
- **Styling**: Use the `data-pending` attribute to style elements based on their pending state
- **Accessibility**: Screen readers announce both `aria-busy` (loading state) and `aria-disabled` (not interactive)
- **Hook usage**: When using the hook directly, spread `pendingProps` **last** to ensure event prevention works correctly

## Credits

- [React Aria's Button component](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/src/Button.tsx) - For the pending state management patterns (Apache License 2.0).
# Speed Dial

A floating action button that reveals a set of actions when triggered.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/speed-dial
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  SpeedDial,
  SpeedDialTrigger,
  SpeedDialContent,
  SpeedDialItem,
  SpeedDialLabel,
  SpeedDialAction,
} from "@/components/ui/speed-dial";

return (
  <SpeedDial>
    <SpeedDialTrigger />
    <SpeedDialContent>
      <SpeedDialItem>
        <SpeedDialLabel />
        <SpeedDialAction />
      </SpeedDialItem>
    </SpeedDialContent>
  </SpeedDial>
)
```

## Examples

### With Labels

Display visible labels next to each action button for better discoverability.


### Hover Mode

Set `activationMode="hover"` on the root component to open the speed dial when hovering over the trigger. The speed dial will automatically close when the mouse leaves. Use the `delay` prop to control how long to wait before the speed dial opens.


### Controlled State

Use the `open` and `onOpenChange` props to control the speed dial state programmatically.


### Sides

The speed dial can expand in different directions using the `side` prop.


### Fixed Positioning

To position the speed dial at a fixed location in the viewport (e.g., bottom-right corner), apply positioning classes to the `SpeedDial` root component, not the trigger.

```tsx
<SpeedDial className="fixed right-4 bottom-4">
  <SpeedDialTrigger>
    <Plus />
  </SpeedDialTrigger>
  <SpeedDialContent>
    {/* actions */}
  </SpeedDialContent>
</SpeedDial>
```


**Important:** Apply `fixed` positioning to the `SpeedDial` root, not the `SpeedDialTrigger`. This ensures the content stays aligned with the trigger.


**Why this matters:** The content uses `absolute` positioning relative to its parent. If you apply `fixed` to the trigger instead, the content won't be able to position itself correctly relative to the trigger.

```tsx
// ❌ Incorrect - content won't align properly
<SpeedDial>
  <SpeedDialTrigger className="fixed right-4 bottom-4">
    <Plus />
  </SpeedDialTrigger>
  <SpeedDialContent>
    {/* actions */}
  </SpeedDialContent>
</SpeedDial>

// ✅ Correct - content aligns with trigger
<SpeedDial className="fixed right-4 bottom-4">
  <SpeedDialTrigger>
    <Plus />
  </SpeedDialTrigger>
  <SpeedDialContent>
    {/* actions */}
  </SpeedDialContent>
</SpeedDial>
```

## API Reference

### SpeedDial

The main container component for the speed dial.

> Props: `SpeedDialProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/speed-dial)

### SpeedDialTrigger

The button that toggles the speed dial open/closed state.

> Props: `SpeedDialTriggerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/speed-dial)

### SpeedDialContent

The container for the action items that appears when the speed dial is open.

> Props: `SpeedDialContentProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/speed-dial)

> CSS variables available — see [docs](https://diceui.com/docs/components/speed-dial)

### SpeedDialItem

A wrapper for each action and its associated label.

> Props: `SpeedDialItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/speed-dial)

> CSS variables available — see [docs](https://diceui.com/docs/components/speed-dial)

### SpeedDialAction

An interactive button within the speed dial that triggers an action.

> Props: `SpeedDialActionProps`

### SpeedDialLabel

A text label that describes the associated action.

> Props: `SpeedDialLabelProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/speed-dial)
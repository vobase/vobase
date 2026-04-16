# Editable

An accessible inline editable component for editing text content in place.

<ComponentTabs name="editable-demo" className="items-start justify-start [&>div]:pt-20"  />

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/editable
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the visually hidden input component into your `components/visually-hidden-input.tsx` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  Editable,
  EditableLabel,
  EditableArea,
  EditablePreview,
  EditableInput,
  EditableTrigger,
  EditableToolbar,
  EditableSubmit,
  EditableCancel,
} from "@/components/ui/editable";

return (
  <Editable>
    <EditableLabel />
    <EditableArea>
      <EditablePreview />
      <EditableInput />
      <EditableTrigger />
    </EditableArea>
    <EditableTrigger />
    <EditableToolbar>
      <EditableSubmit />
      <EditableCancel />
    </EditableToolbar>
  </Editable>
)
```

## Examples

### With Double Click

Trigger edit mode with double click instead of single click.

<ComponentTabs name="editable-double-click-demo" className="items-start justify-start [&>div]:pt-20"/>

### With Autosize

Input that automatically resizes based on content.

<ComponentTabs name="editable-autosize-demo" className="items-start justify-start [&>div]:pt-20" />

### Todo List


### With Form

Control the editable component in a form.

<ComponentTabs name="editable-form-demo" className="items-start justify-start [&>div]:pt-20" />

## API Reference

### Editable

The main container component for editable functionality.

> Props: `EditableProps`

### EditableLabel

The label component for the editable field.

> Props: `EditableLabelProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/editable)

### EditableArea

Container for the preview and input components.

> Props: `EditableAreaProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/editable)

### EditablePreview

The preview component that displays the current value.

> Props: `EditablePreviewProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/editable)

### EditableInput

The input component for editing the value.

> Props: `EditableInputProps`

### EditableTrigger

Button to trigger edit mode.

> Props: `EditableTriggerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/editable)

### EditableToolbar

Container for action buttons.

> Props: `EditableToolbarProps`

### EditableSubmit

Button to submit changes.

> Props: `EditableSubmitProps`

### EditableCancel

Button to cancel changes.

> Props: `EditableCancelProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/editable)
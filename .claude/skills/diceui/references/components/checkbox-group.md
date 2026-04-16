# Checkbox Group

A group of checkboxes that allows multiple selections with support for validation and accessibility.

## Installation

```package-install
@diceui/checkbox-group
```

## Installation with shadcn/ui

### CLI

```package-install
npx shadcn@latest add @diceui/checkbox-group
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/checkbox-group
     ```
  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  CheckboxGroup,
  CheckboxGroupLabel,
  CheckboxGroupList,
  CheckboxGroupItem,
  CheckboxGroupIndicator,
  CheckboxGroupDescription,
} from "@diceui/checkbox-group";

return (
  <CheckboxGroup>
    <CheckboxGroupLabel />
    <CheckboxGroupList>
      <CheckboxGroupItem>
        <CheckboxGroupIndicator />
      </CheckboxGroupItem>
    </CheckboxGroupList>
    <CheckboxGroupDescription>
  </CheckboxGroup>
)
```

## Animated Checkbox


  
    Update `tailwind.config.ts` to include the following animation:

    ```ts
    export default {
      theme: {
        extend: {
          keyframes: {
            "stroke-dashoffset": {
              "0%": { strokeDashoffset: "100%" },
              "100%": { strokeDashoffset: "0" },
            },
          },
          animation: {
            "stroke-dashoffset": "stroke-dashoffset 0.2s linear forwards",
          },
        },
      },
    }
    ```
  
  
    Copy and paste the `CheckboxGroupIndicator` block from the following example into your project.

    
  


## Examples

### Horizontal Orientation


### With Validation

Validate the group with `onValidate` or `required` prop. Can be used for native form validation.


### Multi Selection

Hold down the `Shift` key to select and deselect multiple checkboxes at once.


## API Reference

### CheckboxGroup

Container for the checkbox group.

> Props: `RootProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/checkbox-group)

### CheckboxGroupLabel

Label for the checkbox group.

> Props: `LabelProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/checkbox-group)

### CheckboxGroupList

Container for checkbox items.

> Props: `ListProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/checkbox-group)

### CheckboxGroupItem

Individual checkbox item.

> Props: `ItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/checkbox-group)

### CheckboxGroupIndicator

Visual indicator for the checkbox state.

> Props: `IndicatorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/checkbox-group)

### CheckboxGroupDescription

Optional description text for the checkbox group.

> Props: `DescriptionProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/checkbox-group)

### CheckboxGroupMessage

Error or validation message for the checkbox group.

> Props: `MessageProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/checkbox-group)

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/checkbox-group)
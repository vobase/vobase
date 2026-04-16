# Tags Input

Display a list of tags in an input field with the ability to add, edit, and remove them.

## Installation

```package-install
@diceui/tags-input
```

## Installation with shadcn/ui

### CLI

```package-install
npx shadcn@latest add @diceui/tags-input
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/tags-input
     ```
  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  TagsInput,
  TagsInputLabel,
  TagsInputItem,
  TagsInputItemText,
  TagsInputItemDelete,
  TagsInputInput,
  TagsInputClear,
} from "@diceui/tags-input";

return (
  <TagsInput>
    <TagsInputLabel/>
    <TagsInputItem >
      <TagsInputItemText />
      <TagsInputItemDelete />
    </TagsInputItem>
    <TagsInputInput />
    <TagsInputClear />
  </TagsInput>
)
```

## Examples

### Editable


### With Validation

Validate the input value before adding it to the list. Can be used to prevent duplicate tags.


### With Sortable

`TagsInput` can be composed with [`Sortable`](/docs/components/radix/sortable) to allow reordering of tags.


## API Reference

### TagsInput

Container for the tags input.

> Props: `RootProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/tags-input)

### TagsInputLabel

Label element for the tags input.

> Props: `LabelProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/tags-input)

### TagsInputInput

Text input for adding new tags.

> Props: `InputProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/tags-input)

### TagsInputItem

Individual tag item.

> Props: `ItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/tags-input)


### TagsInputItemText

Text content of a tag.

> Props: `ItemTextProps`


### TagsInputItemDelete

Button to remove a tag.

> Props: `ItemDeleteProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/tags-input)


### TagsInputClear

Button to clear all tags.

> Props: `ClearProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/tags-input)

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/tags-input)
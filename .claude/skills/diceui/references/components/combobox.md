# Combobox

An input with a popover that helps users filter through a list of options.

## Installation

```package-install
@diceui/combobox
```

## Installation with shadcn/ui

### CLI

```package-install
npx shadcn@latest add @diceui/combobox
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/combobox
     ```
  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  Combobox,
  ComboboxLabel,
  ComboboxAnchor,
  ComboboxBadgeList,
  ComboboxBadgeItem,
  ComboboxBadgeItemDelete,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxCancel,
  ComboboxPortal,
  ComboboxContent,
  ComboboxArrow,
  ComboboxLoading,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxItemText,
  ComboboxItemIndicator,
  ComboboxSeparator,
} from "@diceui/combobox";

return (
  <Combobox>
    <ComboboxLabel />
    <ComboboxAnchor>
      <ComboboxBadgeList>
        <ComboboxBadgeItem>
          <ComboboxBadgeItemDelete />
        </ComboboxBadgeItem>
      </ComboboxBadgeList>
      <ComboboxInput />
      <ComboboxTrigger />
      <ComboboxCancel />
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent>
        <ComboboxArrow />
        <ComboboxLoading />
        <ComboboxEmpty />
        <ComboboxGroup>
          <ComboboxGroupLabel />
          <ComboboxItem>
            <ComboboxItemText />
            <ComboboxItemIndicator />
          </ComboboxItem>
        </ComboboxGroup>
        <ComboboxSeparator />
      </ComboboxContent>
    </ComboboxPortal>
  </Combobox>
)
```

## Examples

### With Groups


### With Multiple Selection


### With Custom Filter


### With Debounce


### With Virtualization


### With Tags Input


## API Reference

### Combobox

The container for all combobox parts.

> Props: `RootProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)

### ComboboxLabel

An accessible label that describes the combobox. Associates with the input element for screen readers.

> Props: `LabelProps`

### ComboboxAnchor

A wrapper element that positions the combobox popover relative to the input and trigger. Provides the reference point for popover positioning.

> Props: `AnchorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)

### ComboboxTrigger

A button that toggles the combobox popover. Handles focus management and keyboard interactions for opening/closing the popover.

> Props: `TriggerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)

### ComboboxInput

The text input field that users can type into to filter options.

> Props: `InputProps`

### ComboboxBadgeList

A container for displaying selected items as badges in a multi-select combobox.

> Props: `BadgeListProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)

### ComboboxBadgeItem

An individual badge representing a selected item in a multi-select combobox.

> Props: `BadgeItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)

### ComboboxBadgeItemDelete

A button to remove a selected item from the multi-select combobox.

> Props: `BadgeItemDeleteProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)


### ComboboxCancel

A button that clears the input value and resets the filter.

> Props: `CancelProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)

### ComboboxPortal

A portal for rendering the combobox content outside of its DOM hierarchy.

> Props: `PortalProps`


### ComboboxContent

The popover container for combobox items. Positions the combobox popover relative to the anchor.

> Props: `ContentProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)

> CSS variables available — see [docs](https://diceui.com/docs/components/combobox)

### ComboboxArrow

A visual arrow element that points to the anchor.

> Props: `ArrowProps`

### ComboboxLoading

A loading indicator for asynchronous filtering operations.

> Props: `LoadingProps`

### ComboboxEmpty

A placeholder component displayed when no options match the current filter.

> Props: `EmptyProps`

### ComboboxGroup

A container for logically grouping related options.

> Props: `GroupProps`

### ComboboxGroupLabel

A label that describes a group of options.

> Props: `GroupLabelProps`

### ComboboxItem

An interactive item in the combobox list.

> Props: `ItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/combobox)

### ComboboxItemText

The textual content of an item.

> Props: `ItemTextProps`

### ComboboxItemIndicator

A visual indicator for selected options.

> Props: `ItemIndicatorProps`

### ComboboxSeparator

A visual divider for separating options or groups.

> Props: `SeparatorProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/combobox)
# Mention

A component that allows to mention items in a list by a trigger character.

## Installation

```package-install
@diceui/mention
```

## Installation with shadcn/ui

### CLI

```package-install
npx shadcn@latest add @diceui/mention
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/mention
     ```
  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  Mention,
  MentionLabel,
  MentionInput,
  MentionPortal,
  MentionContent,
  MentionItem,
} from "@diceui/mention";

return (
  <Mention>
    <MentionLabel />
    <MentionInput />
    <MentionPortal>
      <MentionContent>
        <MentionItem />
      </MentionContent>
    </MentionPortal>
  </Mention>
)
```

## Examples

### Custom Trigger


### With Custom Filter


## API Reference

### Mention

The container for all mention parts. Mention tags can be styled using the `data-tag` attribute within the root.

> Props: `RootProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/mention)

### MentionLabel

An accessible label that describes the mention input. Associates with the input element for screen readers.

> Props: `LabelProps`

### MentionInput

The text input field that users can type into to trigger mentions.

> Props: `InputProps`

### MentionPortal

A portal for rendering the mention content outside of its DOM hierarchy.

> Props: `PortalProps`

### MentionContent

The popover container for mention items. Positions the mention popover relative to the cursor position.

> Props: `ContentProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/mention)

> CSS variables available — see [docs](https://diceui.com/docs/components/mention)

### MentionItem

An interactive option in the mention list.

> Props: `ItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/mention)


## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/mention)
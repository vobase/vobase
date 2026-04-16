# Key Value

A dynamic input component for managing key-value pairs with paste support and validation.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/key-value
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot lucide-react
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the visually hidden input component into your `components/visually-hidden-input.tsx` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  KeyValue,
  KeyValueList,
  KeyValueItem,
  KeyValueKeyInput,
  KeyValueValueInput,
  KeyValueRemove,
  KeyValueError,
  KeyValueAdd,
} from "@/components/ui/key-value";

return (
  <KeyValue>
    <KeyValueList>
      <KeyValueItem>
        <KeyValueKeyInput />
        <KeyValueValueInput />
        <KeyValueRemove />
        <KeyValueError field="key" />
        <KeyValueError field="value" />
      </KeyValueItem>
    </KeyValueList>
    <KeyValueAdd />
  </KeyValue>
)
```

## Examples

### With Paste Support

Paste multiple key-value pairs at once. Supports formats like `KEY=VALUE`, `KEY: VALUE`, and tab-separated values.


### With Validation

Add validation rules for keys and values with error messages.


### With Form

Integrate with React Hook Form for form validation.


## API Reference

### KeyValue

The main container component that manages the key-value items state.

> Props: `KeyValueProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/key-value)

### KeyValueList

Container for rendering the list of key-value items.

> Props: `KeyValueListProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/key-value)

### KeyValueItem

Individual key-value pair item container.

> Props: `KeyValueItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/key-value)

### KeyInput

Input field for the key part of the item.

> Props: `KeyValueKeyInputProps`

### ValueInput

Input field for the value part of the item.

> Props: `KeyValueValueInputProps`

### KeyValueRemove

Button to remove a key-value item.

> Props: `KeyValueRemoveProps`

### KeyValueAdd

Button to add a new key-value item.

> Props: `KeyValueAddProps`

### KeyValueError

Error message display for validation errors.

> Props: `KeyValueErrorProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/key-value)

## Features

- **Dynamic Items**: Add and remove key-value pairs dynamically
- **Paste Support**: Paste multiple items at once in various formats (`KEY=VALUE`, `KEY: VALUE`, tab-separated)
- **Validation**: Built-in validation for keys and values with custom validators
- **Duplicate Detection**: Optional prevention of duplicate keys
- **Item Limits**: Set minimum and maximum item counts
- **Form Integration**: Works seamlessly with React Hook Form
- **Controlled/Uncontrolled**: Supports both controlled and uncontrolled patterns
- **Accessibility**: Full keyboard navigation and screen reader support
- **Customizable**: Fully customizable styling and behavior

## Paste Formats

The component supports pasting multiple key-value pairs in the following formats:

```
KEY=VALUE
DATABASE_URL=postgresql://localhost:5432
API_KEY=sk-1234567890

KEY: VALUE
DATABASE_URL: postgresql://localhost:5432
API_KEY: sk-1234567890

KEY	VALUE (tab-separated)
DATABASE_URL	postgresql://localhost:5432
API_KEY	sk-1234567890
```

When pasting multiple lines, the component will automatically parse and create separate items for each line.
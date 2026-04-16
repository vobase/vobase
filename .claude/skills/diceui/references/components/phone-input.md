# Phone Input

An accessible phone input component with automatic country detection and international phone number formatting.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/phone-input
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

  PhoneInput,
  PhoneInputCountrySelect,
  PhoneInputField,
} from "@/components/ui/phone-input";

return (
  <PhoneInput>
    <PhoneInputCountrySelect />
    <PhoneInputField />
  </PhoneInput>
)
```

## Examples

### Custom Countries

Provide a custom list of countries to display in the dropdown.


### With Form

Use the phone input component in a form with validation.


## API Reference

### PhoneInput

The root container component that acts as both the wrapper and input group. Handles layout, borders, and focus states.

> Props: `PhoneInputProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/phone-input)

### PhoneInputCountrySelect

The button component that triggers the country dropdown. Uses Popover and Command internally for the country list.

> Props: `PhoneInputCountrySelectProps`

### PhoneInputField

The input field component for entering the phone number.

> Props: `PhoneInputFieldProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/phone-input)
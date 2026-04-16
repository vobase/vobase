# Visually Hidden Input

A hidden input that remains accessible to assistive technology and maintains form functionality.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/visually-hidden-input
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/visually-hidden-input
     ```
  

  
    Copy and paste the following code into your project.

    
  


## Usage

```tsx


export function CustomForm() {
  const [checked, setChecked] = React.useState(false)
  const controlRef = React.useRef(null)
  
  return (
    <form>
      <button 
        ref={controlRef}
        onClick={() => setChecked(!checked)}
        aria-checked={checked}
        role="checkbox"
      >
        {checked ? "✓" : ""}
      </button>
      <VisuallyHiddenInput
        type="checkbox"
        checked={checked}
        control={controlRef.current}
      />
    </form>
  )
}
```

## API Reference

### VisuallyHiddenInput

A hidden input that maintains form functionality while being visually hidden.

> Props: `VisuallyHiddenInputProps`

# Credits

- [Radix UI](https://github.com/radix-ui/primitives/blob/main/packages/react/checkbox/src/checkbox.tsx#L165-L212) - Checkbox bubble input
# Visually Hidden

Hides content visually while keeping it accessible to screen readers.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/visually-hidden
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/visually-hidden
     ```
  

  
    Copy and paste the following code into your project.

    
  


## Usage

```tsx


export function IconButton() {
  return (
    <button>
      <Icon />
      <VisuallyHidden>Close menu</VisuallyHidden>
    </button>
  )
}
```

## API Reference

### VisuallyHidden

Visually hides content while keeping it accessible.

> Props: `VisuallyHiddenProps`
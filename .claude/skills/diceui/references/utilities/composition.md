# Composition

A collection of utility functions for composing event handlers and refs in React components.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/composition
```

### Manual


  
    Copy and paste the following code into your project.

    
  


## Usage

### Composing Refs

#### useComposedRefs

```tsx


export function Input({ forwardedRef, ...props }) {
  const localRef = React.useRef(null)
  const composedRefs = useComposedRefs(forwardedRef, localRef)

  return <input ref={composedRefs} {...props} />
}
```

#### composeRefs

```tsx


export function Input({ forwardedRef, ...props }) {
  const localRef = React.useRef(null)
  const composedRefs = composeRefs(forwardedRef, localRef)

  return <input ref={composedRefs} {...props} />
} 
```

## API Reference

### composeRefs

A utility function that composes multiple refs together.

> Props: `ComposeRefsProps`

### useComposedRefs

A React hook that composes multiple refs together.

> Props: `UseComposedRefsProps`

## Credits

- [Radix UI](https://github.com/radix-ui/primitives/blob/main/packages/react/compose-refs/src/compose-refs.tsx) - For the `composeRefs` and `useComposedRefs` utilities.
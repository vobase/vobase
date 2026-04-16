# Direction Provider

Provides bidirectional text support (RTL/LTR) across your application.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/direction-provider
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/direction-provider
     ```
  

  
    Copy and paste the following code into your project.

    
  


## Usage

```tsx


export default function App() {
  return (
    <DirectionProvider dir="ltr">
      <YourApp />
    </DirectionProvider>
  )
}
```

## API Reference

### DirectionProvider

Manages direction context for the `useDirection` hook.

> Props: `DirectionProviderProps`

### useDirection

A hook to access the current direction.

```tsx


function Component() {
  const dir = useDirection()
  
  return (
    <Button dir={dir}>
      Do a kickflip
    </Button>
  )
}
```
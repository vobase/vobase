# Portal

Renders React elements into a different part of the DOM tree.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/portal
```

### Manual


  
    Install the following dependencies:

    ```package-install
    @radix-ui/react-slot
    ```
  

  
    Copy and paste the following code into your project.

    
  


## Usage

```tsx


export default function App() {
  return (
    <Portal>
      {/* Content to be rendered in a different part of the DOM */}
      <div>This will be rendered in the document body by default</div>
    </Portal>
  )
}
```

### Custom Container

Specify a target container for portal rendering:

```tsx


export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <div ref={containerRef} />
      <Portal container={containerRef.current}>
        <div>This will be rendered in the custom container</div>
      </Portal>
    </>
  )
}
```

## API Reference

### Portal

A component that renders its children into a different part of the DOM tree using React's `createPortal`.

#### Props

> Props: `PortalProps`
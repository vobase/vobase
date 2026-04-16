# Client Only

Renders client-only components with hydration and fallback support.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/client-only
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @diceui/hydration-boundary
     ```
  

  
    Copy and paste the following code into your project.

    
  


## Usage

```tsx


export default function App() {
  return (
    <ClientOnly fallback={<LoadingSpinner />}>
      <ClientComponent />
    </ClientOnly>
  )
}
```

## API Reference

### ClientOnly

A component that only renders its children on the client side.

> Props: `ClientOnlyProps`
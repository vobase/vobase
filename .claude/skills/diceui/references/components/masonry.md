# Masonry

A responsive masonry layout component for displaying items in a grid.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/masonry
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hook into your `hooks` directory.

    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  Masonry,
  MasonryItem,
} from "@/components/ui/masonry";

return (
  <Masonry>
    <MasonryItem />
  </Masonry>
)
```

## Examples

### Linear Layout

Set `linear` to `true` to maintain item order from left to right.


### Server Side Rendering

Use `defaultWidth` and `defaultHeight`, and item `fallback` to render items on the server. This is useful for preventing layout shift and hydration errors.


## API Reference

### Masonry

The main container component for the masonry layout.

> Props: `MasonryProps`

### MasonryItem

Individual item component within the masonry layout.

> Props: `MasonryItemProps`
# Scroller

A scrollable container with customizable scroll shadows and navigation buttons.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/scroller
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx


<Scroller>
   {/* Scrollable content */}
</Scroller>
```

## Examples

### Horizontal Scroll

Set the `orientation` to `horizontal` to enable horizontal scrolling.


### Hidden Scrollbar

Set the `hideScrollbar` to `true` to hide the scrollbar while maintaining scroll functionality.


### Navigation Buttons

Set the `withNavigation` to `true` to enable navigation buttons.


## API Reference

### Scroller

The main scrollable container component.

> Props: `ScrollerProps`
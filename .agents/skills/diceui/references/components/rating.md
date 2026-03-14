# Rating

An accessible rating component that allows users to provide star ratings with support for half values, keyboard navigation, and form integration.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/rating
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


return (
  <Rating>
    <RatingItem />
  </Rating>
)
```

## Examples

### Themes

Customize the rating component with different colors and icons.


### Controlled State

Control the rating value with state.


### With Form

Integrate the rating component with form validation.


## API Reference

### Rating

The main container component for the rating.

> Props: `RatingProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/rating)

### RatingItem

Individual rating item (star) component.

> Props: `RatingItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/rating)

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/rating)
# Stepper

A component that guides users through a multi-step process with clear visual progress indicators.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/stepper

```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot @radix-ui/react-direction
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  Stepper,
  StepperList,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperTitle,
  StepperDescription,
  StepperSeparator,
  StepperContent,
  StepperPrev,
  StepperNext,
} from "@/components/ui/stepper";

return (
  <Stepper>
    <StepperList>
      <StepperItem>
        <StepperTrigger>
          <StepperIndicator />
          <StepperTitle />
          <StepperDescription />
        </StepperTrigger>
        <StepperSeparator />
      </StepperItem>
    </StepperList>
    <StepperContent />
    <StepperPrev /> 
    <StepperNext />
  </Stepper>
)
```

## Examples

### Vertical Layout

A stepper with vertical orientation for compact layouts.


### With Validation

Use the `onValidate` prop to validate the current step before moving to the next one.


### With Form

A stepper integrated with form validation, showing step-by-step form completion.


## API Reference

### Stepper

The main container component for the stepper.

> Props: `StepperProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stepper)

### StepperList

The container for stepper items, typically an ordered list.

> Props: `StepperListProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stepper)

### StepperItem

A single step item in the stepper.

> Props: `StepperItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stepper)

### StepperTrigger

The clickable trigger for each step, typically wrapping the indicator.

> Props: `StepperTriggerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stepper)

### StepperIndicator

The visual indicator showing the step number or completion status.

> Props: `StepperIndicatorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stepper)

### StepperSeparator

The line connecting steps, showing progress between them.

> Props: `StepperSeparatorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stepper)

### StepperTitle

The title text for each step.

> Props: `StepperTitleProps`

### StepperDescription

The description text for each step.

> Props: `StepperDescriptionProps`

### StepperContent

The content area that displays for the active step.

> Props: `StepperContentProps`

### StepperPrev

A navigation button that moves to the previous step. Automatically disabled on the first step and skips validation when navigating backwards.

> Props: `StepperPrevProps`

### StepperNext

A navigation button that moves to the next step. Automatically disabled on the last step and respects validation rules when navigating forwards.

> Props: `StepperNextProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/stepper)
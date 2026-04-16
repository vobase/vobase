# Time Picker

An accessible time picker component with inline editing and dropdown selection. Automatically adapts to 12-hour or 24-hour format based on user locale.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/time-picker
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the visually hidden input component into your `components/visually-hidden-input.tsx` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  TimePicker,
  TimePickerLabel,
  TimePickerInputGroup,
  TimePickerInput,
  TimePickerSeparator,
  TimePickerTrigger,
  TimePickerContent,
  TimePickerHour,
  TimePickerMinute,
  TimePickerClear,
} from "@/components/ui/time-picker";

return (
  <TimePicker>
    <TimePickerLabel />
    <TimePickerInputGroup>
      <TimePickerInput segment="hour" />
      <TimePickerSeparator />
      <TimePickerInput segment="minute" />
      <TimePickerInput segment="period" />
      <TimePickerTrigger />
    </TimePickerInputGroup>
    <TimePickerContent>
      <TimePickerHour />
      <TimePickerMinute />
      <TimePickerClear />
    </TimePickerContent>
  </TimePicker>
)
```

## Examples

### With Step

Use the `hourStep`, `minuteStep`, and `secondStep` props to set custom intervals for hour, minute, and second selection respectively.


### With Seconds

Include seconds in time selection.


### Custom Placeholders

Customize empty segment placeholders for different display formats.


### Open on Focus

Use the `openOnFocus` prop to open the content when the input is focused.


### Input Group Click Action

Configure what happens when clicking on empty space in the input group. By default, it focuses the first input for inline editing, but you can set it to open the popover instead.


### Controlled State

Control the time picker value programmatically.


### With Form

Use the time picker in a form with validation.


## API Reference

### TimePicker

The main container component for time picker functionality.

> Props: `TimePickerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/time-picker)

### TimePickerLabel

The label component for the time picker field.

> Props: `TimePickerLabelProps`

### TimePickerInputGroup

The container for input segments that sets up CSS variables for dynamic segment widths.

> Props: `TimePickerInputGroupProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/time-picker)

> CSS variables available — see [docs](https://diceui.com/docs/components/time-picker)

Must use style prop to override the css variables of the input segment, because the width is dynamically calculated based on the placeholder length.

### TimePickerTrigger

Button to open the time picker content.

> Props: `TimePickerTriggerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/time-picker)

### TimePickerContent

Container for the time selection interface.

> Props: `TimePickerContentProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/time-picker)

### TimePickerHour

Component for selecting hours.

> Props: `TimePickerHourProps`

### TimePickerMinute

Component for selecting minutes.

> Props: `TimePickerMinuteProps`

### TimePickerSecond

Component for selecting seconds.

> Props: `TimePickerSecondProps`

### TimePickerPeriod

Component for selecting AM/PM in 12-hour format.

> Props: `TimePickerPeriodProps`

### TimePickerSeparator

Visual separator between time units.

> Props: `TimePickerSeparatorProps`

### TimePickerClear

Button to clear the selected time.

> Props: `TimePickerClearProps`

### TimePickerInput

Inline editable input field for time segments (hour, minute, second, period).

> Props: `TimePickerInputProps`

> CSS variables available — see [docs](https://diceui.com/docs/components/time-picker)

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/time-picker)

## Notes

### Behavior

- **Native HTML time input behavior**: Replicates the exact behavior of `<input type="time">` for maximum familiarity
  - Auto-pads single digits instantly (typing "1" shows "01")
  - Smart auto-advance after two digits or when digit exceeds maximum first digit
  - Partial time values supported (e.g., "10:--" instead of "10:00")
  - Selection preserved after actions for seamless typing
- **Inline editing**: All time segments are always visible and editable, no need to open the content
- **Content for convenience**: The clock icon trigger opens the content for easier selection with mouse/touch
- **Keyboard-first design**: Full keyboard navigation between segments using arrow keys or tab
- **Clear segments**: Press Backspace or Delete on a selected segment to clear it back to "--"

### Format & Locale

- **Automatic format detection**: Display format (12-hour vs 24-hour) is automatically detected from user's locale settings
- **Consistent value format**: The time value is always stored in 24-hour format ("HH:mm" or "HH:mm:ss"), regardless of display format
- **Locale override**: Use the `locale` prop to explicitly set a locale (e.g., "en-US" for 12-hour, "en-GB" for 24-hour)
- **Period shortcuts**: In 12-hour format, use A/P or 1/2 keys to quickly set AM/PM
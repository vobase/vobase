# Avatar Group

A component that arranges avatars with overlapping visual effects for displaying multiple users or items.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/avatar-group

```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the following code into your project.

    
  


## Layout

```tsx


<AvatarGroup>
  <Avatar>
    <AvatarImage src="/tony-hawk.png" />
    <AvatarFallback>TH</AvatarFallback>
  </Avatar>
  <Avatar>
    <AvatarImage src="/rodney-mullen.png" />
    <AvatarFallback>RM</AvatarFallback>
  </Avatar>
</AvatarGroup>
```

## Examples

### With Truncation

Automatically truncate long lists and show overflow indicators with the `max` prop.


### With RTL

Support for right-to-left layouts and vertical RTL stacking.


### With Icons

Use the Avatar Group component with icons or other elements beyond avatars.


### Custom Overflow

Customize the overflow indicator with the `renderOverflow` prop.


## API Reference

### AvatarGroup

The main avatar group container that handles layout and masking of child elements.

> Props: `AvatarGroupProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/avatar-group)
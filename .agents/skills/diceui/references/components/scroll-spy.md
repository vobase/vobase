# Scroll Spy

Automatically updates navigation links based on scroll position with support for nested sections and customizable behavior.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/scroll-spy
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hooks into your `hooks` directory.

    
    
    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  ScrollSpy,
  ScrollSpyNav,
  ScrollSpyLink,
  ScrollSpyViewport,
  ScrollSpySection,
} from "@/components/ui/scroll-spy";

return (
  <ScrollSpy>
    <ScrollSpyNav>
      <ScrollSpyLink />
    </ScrollSpyNav>
    <ScrollSpyViewport>
      <ScrollSpySection />
    </ScrollSpyViewport>
  </ScrollSpy>
)
```

## Examples

### Vertical Orientation

Set `orientation="vertical"` for content with vertical navigation.


### Controlled State

Use the `value` and `onValueChange` props to control the active section externally.


### Sticky Layout

For full-page scroll behavior, you can use a sticky positioned navigation sidebar that stays fixed while the content scrolls. This works with the default window scroll (no `scrollContainer` prop needed).

```tsx
<ScrollSpy offset={100}>
  <ScrollSpyNav className="sticky top-20 h-fit">
    <ScrollSpyLink value="introduction">Introduction</ScrollSpyLink>
    <ScrollSpyLink value="getting-started">Getting Started</ScrollSpyLink>
    <ScrollSpyLink value="usage">Usage</ScrollSpyLink>
    <ScrollSpyLink value="api-reference">API Reference</ScrollSpyLink>
  </ScrollSpyNav>

  <ScrollSpyViewport>
    <ScrollSpySection value="introduction">
      <h2>Introduction</h2>
      <p>Your content here...</p>
    </ScrollSpySection>
    
    <ScrollSpySection value="getting-started">
      <h2>Getting Started</h2>
      <p>Your content here...</p>
    </ScrollSpySection>
    
    {/* More content sections */}
  </ScrollSpyViewport>
</ScrollSpy>
```

The key is to apply `sticky top-[offset]` to the `ScrollSpyNav` to keep the navigation visible as the page scrolls.

## API Reference

### ScrollSpy

The root component that manages scroll tracking and contains all ScrollSpy parts.

> Props: `ScrollSpyProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/scroll-spy)

### Nav

The navigation container component.

> Props: `ScrollSpyNavProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/scroll-spy)

### Link

Navigation link that scrolls to a section.

> Props: `ScrollSpyLinkProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/scroll-spy)

### Viewport

The viewport container component for sections.

> Props: `ScrollSpyViewportProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/scroll-spy)

### Section

Content section that gets tracked by the scroll spy.

> Props: `ScrollSpySectionProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/scroll-spy)

## Accessibility

### Keyboard Shortcuts

The ScrollSpy component follows standard link navigation patterns:

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/scroll-spy)
# FPS

A real-time frames per second (FPS) counter component for monitoring performance.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/fps
```

### Manual


  
    Copy and paste the following code into your project.

    
  


## Examples

### Positioning Strategy

Control whether the FPS counter uses `fixed` or `absolute` positioning.


### Custom Position

Choose from four corner positions for the FPS counter.

```tsx


export default function App() {
  return (
    <div>
      <Fps position="bottom-left" />
      {/* Your app content */}
    </div>
  )
}
```

### Custom Thresholds

Configure warning and error thresholds for color-coded performance indicators.

```tsx


export default function App() {
  return (
    <div>
      <Fps 
        warningThreshold={45}
        errorThreshold={30}
      />
      {/* Your app content */}
    </div>
  )
}
```

### Conditional Rendering

Enable the FPS counter only in development environments.

```tsx


export default function App() {
  const isDevelopment = process.env.NODE_ENV === "development"
  
  return (
    <div>
      <Fps enabled={isDevelopment} />
      {/* Your app content */}
    </div>
  )
}
```

## API Reference

### Fps

A component that displays a real-time FPS counter overlay.

> Props: `FpsProps`

## Features

- **Real-time monitoring**: Uses `requestAnimationFrame` for accurate FPS measurement
- **Color-coded display**: Automatically changes color based on performance thresholds
  - Green: Good performance (above warning threshold)
  - Yellow: Warning (below warning threshold)
  - Red: Poor performance (below error threshold)
- **Flexible positioning**: Choose between `fixed` and `absolute` positioning strategies
- **Customizable position**: Choose from four corner positions
- **Configurable update interval**: Control how often the FPS value updates
- **Performance optimized**: Minimal overhead with efficient frame counting

## Positioning Strategies

### Fixed Positioning

When using `strategy="fixed"`, the FPS counter is positioned relative to the viewport and rendered via a portal into the document body. This is useful when you want the counter to remain visible while scrolling.

```tsx
<Fps strategy="fixed" position="top-right" />
```

### Absolute Positioning

When using `strategy="absolute"`, the FPS counter is rendered directly in place (without a portal) and positioned relative to its nearest positioned ancestor. This is useful when you want the counter to be contained within a specific element with a `relative` wrapper.

```tsx
<div className="relative">
  <Fps strategy="absolute" position="bottom-left" />
</div>
```

**Note:** Unlike `fixed` positioning, `absolute` positioning does not use a portal, so the component will respect relative positioning contexts and be contained within its parent element.

## Performance Considerations

The FPS counter uses `requestAnimationFrame` to measure frame rate, which has minimal performance impact. The component:

- Only updates the display at the specified interval (default: 500ms)
- Uses refs to avoid unnecessary re-renders
- Automatically cleans up animation frames on unmount

For production builds, consider disabling the FPS counter:

```tsx
<Fps enabled={process.env.NODE_ENV === "development"} />
```
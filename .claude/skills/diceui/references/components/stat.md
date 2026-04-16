# Stat

A flexible component for displaying key metrics and statistics with support for trends, indicators, and descriptions.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/stat
```

### Manual


  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  Stat,
  StatLabel,
  StatValue,
  StatIndicator,
  StatTrend,
  StatDescription,
  StatSeparator,
} from "@/components/ui/stat";

return (
  <Stat>
    <StatLabel>Total Revenue</StatLabel>
    <StatIndicator variant="icon" color="success">
      <DollarSign />
    </StatIndicator>
    <StatValue>$45,231</StatValue>
    <StatTrend trend="up">
      <ArrowUp />
      +20.1% from last month
    </StatTrend>
    <StatSeparator />
    <StatDescription>
      Total revenue generated in the current billing period
    </StatDescription>
  </Stat>
);
```

## Examples

### Variants

Explore different indicator variants and color themes.


### Layout Options

Combine different stat components to create rich statistical displays.


## API Reference

### Stat

The main container component that provides a card-style layout for displaying statistics.

> Props: `StatProps`

### StatLabel

A label component for the statistic title or category.

> Props: `StatLabelProps`

### StatIndicator

A visual indicator component that can display icons, badges, or action buttons with various color themes.

> Props: `StatIndicatorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stat)

### StatValue

Displays the primary statistic value with emphasized typography.

> Props: `StatValueProps`

### StatTrend

Displays trend information with directional styling (up, down, or neutral).

> Props: `StatTrendProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/stat)

### StatSeparator

A horizontal separator for dividing content within the stat card.

> Props: `StatSeparatorProps`

### StatDescription

Additional descriptive text for providing context about the stat.
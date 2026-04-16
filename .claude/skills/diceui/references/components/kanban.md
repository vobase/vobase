# Kanban

A drag and drop kanban board component for organizing items into columns.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/kanban
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @dnd-kit/core @dnd-kit/modifiers @dnd-kit/sortable @dnd-kit/utilities @radix-ui/react-slot
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

  

  
  
    Copy and paste the following code into your project.

    
  


## Layout

Import the parts, and compose them together.

```tsx

  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnHandle,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
} from "@/components/ui/kanban";

return (
  <Kanban>
    <KanbanBoard>
      <KanbanColumn>
        <KanbanColumnHandle />
        <KanbanItem>
          <KanbanItemHandle />
        </KanbanItem>
      </KanbanColumn>
    </KanbanBoard>
    <KanbanOverlay />
  </Kanban>
)
```

## Usage

### With Primitive Values

When using primitive arrays (strings, numbers), the `getItemValue` prop is optional. The component will automatically use the items themselves as unique identifiers.

```tsx
const [columns, setColumns] = React.useState({
  todo: ["Task 1", "Task 2"],
  done: ["Task 3"],
});

<Kanban.Kanban value={columns} onValueChange={setColumns}>
  <Kanban.Board>
    {Object.entries(columns).map(([columnId, items]) => (
      <Kanban.Column key={columnId} value={columnId}>
        {items.map((item) => (
          <Kanban.Item key={item} value={item}>
            {item}
          </Kanban.Item>
        ))}
      </Kanban.Column>
    ))}
  </Kanban.Board>
</Kanban.Kanban>
```

### With Object Arrays

When using object arrays, the `getItemValue` prop is required to extract unique identifiers from each item.

```tsx
const [columns, setColumns] = React.useState({
  todo: [
    { id: 1, title: "Task 1" },
    { id: 2, title: "Task 2" },
  ],
  done: [
    { id: 3, title: "Task 3" },
  ],
});

<Kanban.Kanban
  value={columns}
  onValueChange={setColumns}
  getItemValue={(item) => item.id}
>
  <Kanban.Board>
    {Object.entries(columns).map(([columnId, items]) => (
      <Kanban.Column key={columnId} value={columnId}>
        {items.map((item) => (
          <Kanban.Item key={item.id} value={item.id}>
            {item.title}
          </Kanban.Item>
        ))}
      </Kanban.Column>
    ))}
  </Kanban.Board>
</Kanban.Kanban>
```

## Examples

### With Dynamic Overlay

Display a dynamic overlay when an item or column is being dragged.


## API Reference

### Kanban

The main container component for kanban board functionality.

> Props: `KanbanProps`

### KanbanBoard

Container for kanban columns.

> Props: `KanbanBoardProps`

### Column

Individual kanban column component.

> Props: `KanbanColumnProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/kanban)

### ColumnHandle

A button component that acts as a drag handle for kanban columns.

> Props: `KanbanColumnHandleProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/kanban)

### KanbanItem

Individual kanban item component.

> Props: `KanbanItemProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/kanban)

### KanbanItemHandle

A button component that acts as a drag handle for kanban items.

> Props: `KanbanItemHandleProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/kanban)

### Overlay

The overlay component that appears when an item or column is being dragged.

> Props: `KanbanOverlayProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/kanban)
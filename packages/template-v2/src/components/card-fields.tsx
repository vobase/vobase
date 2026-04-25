export interface FieldItem {
  type?: 'field'
  label: string
  value: string
}

export function CardFields({ items }: { items: FieldItem[] }) {
  if (items.length === 0) return null

  if (items.length >= 5) {
    return (
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-border border-b">
            <th className="py-1 pr-4 text-left font-medium text-muted-foreground">Field</th>
            <th className="py-1 text-left font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.label} className="border-border/50 border-b last:border-0">
              <td className="py-1 pr-4 text-muted-foreground">{item.label}</td>
              <td className="py-1">{item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd className="text-foreground text-xs">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

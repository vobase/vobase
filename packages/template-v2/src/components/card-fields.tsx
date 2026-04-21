export interface FieldItem {
  type?: 'field'
  label: string
  value: string
}

export function CardFields({ items }: { items: FieldItem[] }) {
  if (items.length === 0) return null

  if (items.length >= 5) {
    return (
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1 pr-4 font-medium text-muted-foreground">Field</th>
            <th className="text-left py-1 font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.label} className="border-b border-border/50 last:border-0">
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
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-xs text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

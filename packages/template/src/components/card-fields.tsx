export interface FieldItem {
  type?: 'field'
  label: string
  value: string
}

export function CardFields({ items }: { items: FieldItem[] }) {
  if (items.length === 0) return null

  if (items.length >= 5) {
    return (
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-1.5 pr-6 text-left font-medium text-muted-foreground">Field</th>
            <th className="py-1.5 text-left font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.label} className="border-border/50 border-b align-top last:border-0">
              <td className="whitespace-nowrap py-1.5 pr-6 text-muted-foreground">{item.label}</td>
              <td className="py-1.5 text-foreground">{item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="whitespace-nowrap text-muted-foreground text-sm">{item.label}</dt>
          <dd className="text-foreground text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

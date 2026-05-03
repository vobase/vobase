import { AttributeTable as SharedAttributeTable } from '@/components/attributes/attribute-table'
import { useAttributeDefinitions, useSetContactAttributes } from '../hooks/use-attributes'
import type { AttributeValue } from '../schema'

interface Props {
  contactId: string
  values: Record<string, AttributeValue>
}

export function AttributeTable({ contactId, values }: Props) {
  const { data: defs, isLoading } = useAttributeDefinitions()
  const mutation = useSetContactAttributes(contactId)
  return (
    <SharedAttributeTable
      defs={defs}
      isLoading={isLoading}
      values={values}
      mutation={mutation}
      idPrefix="attr"
      manageHref="/contacts/attributes"
      emptyTitle="No custom attributes yet"
      emptyDescription="Create shared fields once on the attributes page, then fill them in for every contact."
    />
  )
}

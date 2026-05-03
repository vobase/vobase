import { AttributeTable as SharedAttributeTable } from '@/components/attributes/attribute-table'
import { useAttributeDefinitions, useSetStaffAttributes } from '../hooks/use-attributes'
import type { AttributeValue } from '../schema'

interface Props {
  userId: string
  values: Record<string, AttributeValue>
}

export function AttributeTable({ userId, values }: Props) {
  const { data: defs, isLoading } = useAttributeDefinitions()
  const mutation = useSetStaffAttributes(userId)
  return (
    <SharedAttributeTable
      defs={defs}
      isLoading={isLoading}
      values={values}
      mutation={mutation}
      idPrefix="staff-attr"
      manageHref="/team/attributes"
      emptyTitle="No staff attributes yet"
      emptyDescription="Create shared fields once on the attributes page, then fill them in for every staff member."
    />
  )
}

export interface Permission {
  resource: string
  actions: string[]
}

export interface OrganizationContext {
  organizationId: string
  role: string
  permissions?: Permission[]
}

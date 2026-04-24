/**
 * Knowledge Base search configuration — domain-specific data for the SearchBar component.
 */

/** Animated placeholder phrases shown in the search bar. */
export const EXAMPLES: string[] = [
  'how to set up authentication',
  'API rate limiting best practices',
  'database migration guide',
  'deployment configuration',
  'error handling patterns',
  'user permissions and roles',
  'webhook integration setup',
  'environment variables reference',
  'getting started tutorial',
  'REST API endpoints',
  'file upload configuration',
  'email notification setup',
  'background job processing',
  'data export and import',
  'search and filtering',
  'audit log configuration',
  'security best practices',
  'performance optimization',
  'troubleshooting common errors',
  'module development guide',
  'schema migration workflow',
  'testing strategies',
  'CI/CD pipeline setup',
  'monitoring and logging',
]

/** Category names for filter chips and autocomplete corpus. */
export const CATEGORIES: string[] = [
  'Guides',
  'API Reference',
  'Configuration',
  'Troubleshooting',
  'Architecture',
  'Security',
  'Deployment',
]

/** Seed for autocomplete: EXAMPLES as-is (no suffix stripping needed for KB domain). */
export const AUTOCOMPLETE_SEED: string[] = [...EXAMPLES]

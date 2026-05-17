import { createAutomationsService, installAutomationsService } from '@modules/automations/service/automations'

import type { ModuleDef } from '~/runtime'
import { automationsTools } from './agent'
import { automationsVerbs } from './cli'

// US-005 will replace `modules/schedules/` and wire this module into runtime/modules.ts.
// US-002 keeps this module isolated — it compiles standalone, no producer/consumer wiring.

const automations: ModuleDef = {
  name: 'automations',
  requires: ['agents'],
  agent: { tools: automationsTools },
  init(ctx) {
    installAutomationsService(createAutomationsService({ db: ctx.db }))
    ctx.cli.registerAll(automationsVerbs)
  },
}

export default automations

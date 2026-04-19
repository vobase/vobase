import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'

export default defineModule({
  name: 'settings',
  version: '1.0',
  requires: [],
  manifest,
  init(_ctx) {
    // stub — no services to wire in Phase 1
  },
})

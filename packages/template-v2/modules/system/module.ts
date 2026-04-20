import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'

export default defineModule({
  name: 'system',
  version: '1.0',
  requires: [],
  manifest,
  init(_ctx) {
    // stub — no domain services to wire
  },
})

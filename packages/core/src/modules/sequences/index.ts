import { Hono } from 'hono';
import { defineBuiltinModule } from '../../module';
import { sequences } from './schema';

export { sequences } from './schema';
export { nextSequence, type SequenceOptions } from './next-sequence';

export function createSequencesModule() {
  return defineBuiltinModule({
    name: '_sequences',
    schema: { sequences },
    routes: new Hono(),
    init: () => {},
  });
}

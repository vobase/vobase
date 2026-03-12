import { Hono } from 'hono';
import { defineBuiltinModule } from '../../module';
import { credentialsTable } from './schema';

export { credentialsTable } from './schema';
export { encrypt, decrypt, getCredential, setCredential, deleteCredential } from './encrypt';

export function createCredentialsModule() {
  return defineBuiltinModule({
    name: '_credentials',
    schema: { credentialsTable },
    routes: new Hono(),
    init: () => {},
  });
}

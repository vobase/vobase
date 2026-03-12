import type { VobaseModule } from '@vobase/core';

import { systemModule } from './system';

// Register your custom modules here
export const modules: VobaseModule[] = [systemModule];

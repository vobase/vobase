import {
  layout,
  physical,
  rootRoute,
  route,
} from '@tanstack/virtual-file-routes';

export const routes = rootRoute('root.tsx', [
  route('/chat/$channelRoutingId', 'chat.$channelRoutingId.tsx'),
  layout('auth', 'shell/auth/layout.tsx', [
    route('/login', 'shell/auth/login.tsx'),
    route('/signup', 'shell/auth/signup.tsx'),
  ]),
  layout('app', 'shell/app-layout.tsx', [
    route('/', 'home.tsx'),
    route(
      '/conversations/$conversationId',
      '../modules/ai/pages/conversations/$conversationId.tsx',
    ),
    route('/contacts', '../modules/ai/pages/contacts/index.tsx'),
    route(
      '/contacts/$contactId',
      '../modules/ai/pages/contacts/$contactId.tsx',
    ),
    route('/channels', '../modules/ai/pages/channels/index.tsx'),
    layout('ai', '../modules/ai/pages/ai/layout.tsx', [
      route('/ai/agents', '../modules/ai/pages/ai/agents.tsx'),
      route('/ai/evals', '../modules/ai/pages/ai/evals.tsx'),
      route('/ai/guardrails', '../modules/ai/pages/ai/guardrails.tsx'),
      route('/ai/memory', '../modules/ai/pages/ai/memory.tsx'),
    ]),
    route('/knowledge-base', '../modules/knowledge-base/pages/layout.tsx', [
      physical('../modules/knowledge-base/pages/'),
    ]),
    route('/system', '../modules/system/pages/layout.tsx', [
      physical('../modules/system/pages/'),
    ]),
    route('/settings', 'shell/settings/layout.tsx', [
      route('/profile', 'shell/settings/profile.tsx'),
      route('/appearance', 'shell/settings/appearance.tsx'),
      route('/api-keys', 'shell/settings/api-keys.tsx'),
      route('/integrations', 'shell/settings/integrations.tsx'),
      route('/organization', 'shell/settings/organization.tsx'),
    ]),
  ]),
]);

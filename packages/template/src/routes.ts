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
    route('/pending', 'shell/auth/pending.tsx'),
  ]),
  layout('app', 'shell/app-layout.tsx', [
    route('/', 'home.tsx'),
    route('/agents', '../modules/agents/pages/layout.tsx', [
      physical('../modules/agents/pages/'),
    ]),
    route('/automation', '../modules/automation/pages/layout.tsx', [
      physical('../modules/automation/pages/'),
    ]),
    // Campaigns: broadcasts + rules (physical scan of messaging/pages/campaigns/)
    route('/campaigns', '../modules/messaging/pages/campaigns/layout.tsx', [
      physical('../modules/messaging/pages/campaigns/'),
    ]),
    route('/knowledge-base', '../modules/knowledge-base/pages/layout.tsx'),
    // Messaging: explicit routes excluding campaigns/ subdir to avoid double-registration
    route('/messaging', '../modules/messaging/pages/layout.tsx', [
      route('/labels', '../modules/messaging/pages/labels.tsx'),
      route('/inbox', '../modules/messaging/pages/inbox.tsx', [
        route('/', '../modules/messaging/pages/inbox/index.tsx'),
        route('/$contactId', '../modules/messaging/pages/inbox/$contactId.tsx'),
      ]),
      route('/templates', '../modules/messaging/pages/templates/index.tsx'),
      route(
        '/conversations',
        '../modules/messaging/pages/conversations/index.tsx',
      ),
      route(
        '/conversations/$conversationId',
        '../modules/messaging/pages/conversations/$conversationId.tsx',
      ),
      route('/contacts', '../modules/messaging/pages/contacts/index.tsx'),
      route(
        '/contacts/attributes',
        '../modules/messaging/pages/contacts/attributes.tsx',
      ),
      route(
        '/contacts/$contactId',
        '../modules/messaging/pages/contacts/$contactId.tsx',
      ),
      route('/channels', '../modules/messaging/pages/channels/index.tsx'),
    ]),
    route('/system', '../modules/system/pages/layout.tsx', [
      physical('../modules/system/pages/'),
    ]),
    route('/settings', 'shell/settings/layout.tsx', [
      route('/profile', 'shell/settings/profile.tsx'),
      route('/account', 'shell/settings/account.tsx'),
      route('/appearance', 'shell/settings/appearance.tsx'),
      route('/notifications', 'shell/settings/notifications.tsx'),
      route('/display', 'shell/settings/display.tsx'),
      route('/api-keys', 'shell/settings/api-keys.tsx'),
    ]),
  ]),
]);

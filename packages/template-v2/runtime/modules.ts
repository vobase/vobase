/**
 * Module registry — the static list of modules the template ships with.
 *
 * Order is the canonical init order; `bootModules` topologically re-sorts by
 * each module's `requires`, but this array remains the dependency-friendly
 * declaration. Adding a module = adding an import + a list entry here.
 */

import agents from '@modules/agents/module'
import changes from '@modules/changes/module'
import channels from '@modules/channels/module'
import contacts from '@modules/contacts/module'
import drive from '@modules/drive/module'
import messaging from '@modules/messaging/module'
import schedules from '@modules/schedules/module'
import settings from '@modules/settings/module'
import system from '@modules/system/module'
import team from '@modules/team/module'

export const modules = [settings, contacts, team, drive, messaging, agents, schedules, channels, changes, system]

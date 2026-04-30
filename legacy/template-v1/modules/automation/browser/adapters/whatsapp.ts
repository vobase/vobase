import type { Adapter } from '../types'

export const whatsappAdapter: Adapter = {
  id: 'whatsapp',
  name: 'WhatsApp Web',
  match: /web\.whatsapp\.com/,
  actions: {
    createGroup: {
      name: 'Create Group',
      requiresApproval: true,
      async execute(input, h) {
        const { groupName, participants } = input as {
          groupName: string
          participants: string[]
        }

        // 1. Open new chat menu
        await h.clickElement({ label: 'New chat' })
        await h.sleep(500)

        // 2. Click "New group"
        await h.waitForElement({ text: 'New group' })
        await h.clickElement({ text: 'New group' })
        await h.sleep(500)

        // 3. Add each participant by searching
        for (const phone of participants) {
          await h.waitForElement({ role: 'textbox' })
          await h.typeInto({ role: 'textbox', placeholder: 'Search' }, phone)
          await h.sleep(1000) // Wait for search results

          // Click the search result matching the phone number
          await h.waitForElement({ text: phone }, 5000)
          await h.clickElement({ text: phone })
          await h.sleep(500)
        }

        // 4. Click forward/next arrow
        await h.clickElement({ label: 'arrow_forward' })
        await h.sleep(500)

        // 5. Enter group name
        await h.waitForElement({ role: 'textbox' })
        await h.typeInto({ role: 'textbox' }, groupName)
        await h.sleep(300)

        // 6. Click create/check button
        await h.clickElement({ label: 'check' })
        await h.sleep(2000) // Wait for group creation

        return {
          success: true,
          output: {
            groupName,
            membersAdded: participants.length,
          },
        }
      },
    },

    getGroupMembers: {
      name: 'Get Group Members',
      requiresApproval: false,
      async execute(_input, h) {
        // Click the group header to open info panel
        await h.clickElement({ role: 'button', title: 'Profile details' })
        await h.sleep(1000)

        // Get all member elements from the info panel
        const members = await h.flattenDOM()
        const memberElements = members.filter((el) => el.role === 'listitem' && el.text.length > 0 && el.text !== 'You')

        const memberNames = memberElements.map((el) => el.text)

        return {
          success: true,
          output: { members: memberNames, count: memberNames.length },
        }
      },
    },
  },
}

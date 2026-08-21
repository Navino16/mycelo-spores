import { defineConfig } from '@mycelo/septum'
import type { ChannelIdentity, HyphaContext, HyphaModule, OutgoingContent } from '@mycelo/septum'
import { z } from 'zod'
import { SignalRpc } from './rpc.js'
import { normalize } from './normalize.js'

const schema = z.object({
  socket: z.string().min(1),
  account: z.string().min(1),
})

type Config = z.infer<typeof schema>

interface SignalGroupMember {
  number: string | null
  uuid: string
  isAdmin: boolean
}

interface SignalGroup {
  id: string
  members: SignalGroupMember[]
}

const GROUP_PREFIX = 'group:'

/** Groups send with `groupId`, direct messages with `recipient` (findings §3). */
function sendTarget(conversationId: string): { groupId: string } | { recipient: readonly [string] } {
  return conversationId.startsWith(GROUP_PREFIX)
    ? { groupId: conversationId.slice(GROUP_PREFIX.length) }
    : { recipient: [conversationId] }
}

async function findGroup(rpc: SignalRpc, account: string, groupId: string): Promise<SignalGroup | undefined> {
  const result = await rpc.request('listGroups', { account })
  const groups = Array.isArray(result) ? (result as SignalGroup[]) : []
  return groups.find((g) => g.id === groupId)
}

export default {
  configSchema: defineConfig(schema),
  create: () => {
    let config: Config | null = null
    let rpc: SignalRpc | null = null
    let listening = false

    return {
      connect: async (ctx: HyphaContext<Config>) => {
        config = ctx.config
        const client = new SignalRpc(config.socket, (notification) => {
          if (notification.method !== 'receive') return
          const message = normalize(notification)
          if (message !== null && listening) ctx.emit(message)
        })
        await client.connect()
        rpc = client
      },
      listen: () => {
        listening = true
      },
      stop: () => {
        listening = false
        rpc?.close()
        rpc = null
        return Promise.resolve()
      },
      send: async (conversationId: string, out: OutgoingContent): Promise<void> => {
        if (rpc === null || config === null) {
          throw new Error('signal hypha sent before connect()')
        }
        if (out.text === undefined) return
        await rpc.request('send', { account: config.account, message: out.text, ...sendTarget(conversationId) })
      },
      listGroupMembers: async (groupId: string): Promise<readonly ChannelIdentity[]> => {
        if (rpc === null || config === null) return []
        let group = await findGroup(rpc, config.account, groupId)
        if (group === undefined) {
          // findings §8: a linked device does not learn about a group by itself. One
          // sync-and-retry on a miss makes staleness self-correcting rather than permanent.
          await rpc.request('sendSyncRequest', {}).catch(() => undefined)
          group = await findGroup(rpc, config.account, groupId)
        }
        if (group === undefined) return []
        return group.members.map((member) => ({ channel: 'signal', externalId: member.uuid }))
      },
    }
  },
} satisfies HyphaModule<Config>

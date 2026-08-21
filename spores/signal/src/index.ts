import { defineConfig } from '@mycelo/septum'
import type { ChannelIdentity, HyphaContext, HyphaModule, Logger, OutgoingContent } from '@mycelo/septum'
import { z } from 'zod'
import { SignalRpc } from './rpc.js'
import { GROUP_PREFIX, normalize } from './normalize.js'

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
    let logger: Logger | null = null
    let rpc: SignalRpc | null = null
    let listening = false

    return {
      connect: async (ctx: HyphaContext<Config>) => {
        config = ctx.config
        logger = ctx.logger
        const client = new SignalRpc(
          config.socket,
          (notification) => {
            if (notification.method !== 'receive') return
            const message = normalize(notification)
            if (message !== null && listening) ctx.emit(message)
          },
          {
            onProtocolError: (error, line) =>
              ctx.logger.warn('signal: ignored an unusable line from the daemon', { error: error.message, line }),
          },
        )
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
        // findings: not measured. Silently dropping either would be the exact
        // silent-reply-loss class this project keeps paying for.
        if (out.reactTo !== undefined || (out.attachments?.length ?? 0) > 0) {
          throw new Error('signal: attachments and reactions are not implemented')
        }
        // The core's "at least one field" invariant is cleared by attachments: [], which then
        // leaves nothing to send. Returning silently would lose the reply with no trace.
        if (out.text === undefined) {
          throw new Error('signal: nothing to send — the reply carried no text')
        }
        await rpc.request('send', { account: config.account, message: out.text, ...sendTarget(conversationId) })
      },
      listGroupMembers: async (groupId: string): Promise<readonly ChannelIdentity[]> => {
        if (rpc === null || config === null) return []
        try {
          let group = await findGroup(rpc, config.account, groupId)
          if (group === undefined) {
            // findings §8: a linked device does not learn about a group by itself. One
            // sync-and-retry on a miss makes staleness self-correcting rather than permanent.
            try {
              await rpc.request('sendSyncRequest', { account: config.account })
            } catch (e) {
              logger?.warn('signal: sendSyncRequest failed while resolving group membership', {
                error: (e as Error).message,
              })
            }
            group = await findGroup(rpc, config.account, groupId)
          }
          if (group === undefined) return []
          return group.members.map((member) => ({ channel: 'signal', externalId: member.uuid }))
        } catch (e) {
          // A dead daemon must silence only signal's own groups, not every channel: an
          // enforcing inhibitor treats a rejection here as "refuse everything" (chain.ts).
          logger?.warn('signal: listGroupMembers failed', { error: (e as Error).message })
          return []
        }
      },
    }
  },
} satisfies HyphaModule<Config>

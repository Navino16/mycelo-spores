import type { IncomingMessage } from '@mycelo/septum'

interface SignalGroupInfo {
  groupId: string
  groupName?: string
}

interface SignalDataMessage {
  timestamp: number
  message: string | null
  groupInfo?: SignalGroupInfo
}

interface SignalEnvelope {
  sourceUuid: string
  sourceName?: string
  timestamp: number
  dataMessage?: SignalDataMessage
}

interface SignalReceiveNotification {
  method: 'receive'
  params: { envelope: SignalEnvelope; account: string }
}

/** A group's conversation id. Shared with send(), which must route back by groupId, not recipient. */
export const GROUP_PREFIX = 'group:'

function isReceiveNotification(frame: unknown): frame is SignalReceiveNotification {
  if (typeof frame !== 'object' || frame === null) return false
  const candidate = frame as Record<string, unknown>
  return candidate.method === 'receive' && typeof candidate.params === 'object' && candidate.params !== null
}

/**
 * Pure: a signal-cli `receive` notification in, an `IncomingMessage` out, or `null` for
 * anything that is not a message to answer. `dataMessage` presence is not sufficient — a
 * remote delete is a `dataMessage` with `message: null` (findings §4).
 */
export function normalize(frame: unknown): IncomingMessage | null {
  if (!isReceiveNotification(frame)) return null
  const { envelope } = frame.params
  const dataMessage = envelope.dataMessage
  // Covers both a `dataMessage` missing `message` entirely and one carrying `null`
  // (a remote delete, findings §4) — either would otherwise violate IncomingMessage.text: string.
  if (dataMessage === undefined || typeof dataMessage.message !== 'string') return null

  const groupInfo = dataMessage.groupInfo
  const conversationId = groupInfo === undefined ? envelope.sourceUuid : `${GROUP_PREFIX}${groupInfo.groupId}`

  return {
    channel: 'signal',
    conversationId,
    messageId: String(dataMessage.timestamp),
    ...(groupInfo === undefined ? {} : { group: { id: groupInfo.groupId, name: groupInfo.groupName } }),
    sender: {
      channel: 'signal',
      // findings §5: externalId must be the uuid, never a phone number — it is the only
      // identifier group-gate can also see in listGroupMembers.
      externalId: envelope.sourceUuid,
      ...(envelope.sourceName === undefined ? {} : { displayName: envelope.sourceName }),
    },
    text: dataMessage.message,
    attachments: [],
    raw: frame,
    receivedAt: new Date(envelope.timestamp),
  }
}

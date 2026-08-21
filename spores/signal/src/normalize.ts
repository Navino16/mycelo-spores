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
  if (dataMessage === undefined || dataMessage.message === null) return null

  const groupInfo = dataMessage.groupInfo
  const conversationId = groupInfo === undefined ? envelope.sourceUuid : `group:${groupInfo.groupId}`

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

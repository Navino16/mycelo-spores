import type { EnzymeContext, EnzymeModule, TranslatableRef } from '@mycelo/septum'
import type { PlexApi, PlexSession } from '@mycelo/spore-plex'

/**
 * No jellyfin spore exists, so this is the author's assertion of the shape one would publish
 * (design §9). The two services do not answer the same thing, which is why the branch below is a
 * real branch and not a formality.
 */
interface JellyfinSession {
  title: string
  series?: string
  user: string
  device: string
}

interface JellyfinApi {
  sessions(): Promise<readonly JellyfinSession[] | TranslatableRef>
}

const isRef = <T>(r: readonly T[] | TranslatableRef): r is TranslatableRef => 'domain' in r

const frame = async (ctx: EnzymeContext<unknown>, lines: readonly string[]): Promise<void> => {
  await ctx.reply({
    text: lines.length === 0 ? ctx.t('reply.empty') : ctx.t('reply.list', { lines: lines.join('\n') }),
  })
}

export default {
  create: () => ({
    handlers: {
      handleWatching: async (_invocation, ctx) => {
        if (ctx.has('jellyfin')) {
          const result = await ctx.rhiza<JellyfinApi>('jellyfin').sessions()
          if (isRef(result)) {
            await ctx.reply({ text: ctx.t(result) })
            return
          }
          await frame(ctx, result.map((s) => (s.series === undefined
            ? ctx.t('reply.jellyfin-film', { title: s.title, user: s.user, device: s.device })
            : ctx.t('reply.jellyfin-episode', { series: s.series, title: s.title, user: s.user, device: s.device }))))
          return
        }
        if (ctx.has('plex')) {
          const result = await ctx.rhiza<PlexApi>('plex').sessions()
          if (isRef(result)) {
            await ctx.reply({ text: ctx.t(result) })
            return
          }
          await frame(ctx, result.map((s: PlexSession) => {
            // '?' rather than a catalogue key: a missing duration is language-neutral, and a second
            // key per line kind would double the catalogue for one absent number.
            const progress = s.progress === null ? '?' : String(s.progress)
            // `state` drives an ICU select in the catalogue, so the paused wording stays with the
            // translator instead of being concatenated here (findings §5.1).
            const state = s.paused ? 'paused' : 'playing'
            return s.series === undefined
              ? ctx.t('reply.plex-film', { title: s.title, user: s.user, player: s.player, progress, state })
              : ctx.t('reply.plex-episode', { series: s.series, title: s.title, user: s.user, player: s.player, progress, state })
          }))
          return
        }
        // Rare, not unreachable: the any_of group is mandatory, but the core drops a rhiza that
        // failed to start() from `resolved`, so has() can answer false for both alternatives.
        await ctx.reply({ text: ctx.t('reply.none') })
      },
    },
  }),
} satisfies EnzymeModule

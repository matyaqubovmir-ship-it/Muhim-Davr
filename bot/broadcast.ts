/**
 * Function 4, from the command line — an announcement to one tuman.
 *
 *   npm run broadcast -- --tuman "Urganch" --message "Matn..."
 *   npm run broadcast -- --tuman "Urganch" --message "Matn..." --send
 *
 * WITHOUT --send IT IS A DRY RUN. It prints the recipient count and the message
 * and sends nothing. A broadcast is irreversible and reaches pregnant women's
 * phones; the safe thing must be the thing that happens when you get the flags
 * slightly wrong.
 *
 * No AI is involved — see bot/announce.ts.
 */

import { parseBroadcastArgs, sendAnnouncement } from './announce.ts'
import { loadBotConfig } from './config.ts'
import { createSupabaseStore } from './store.ts'
import { getBotSupabase } from './supabase.ts'
import { createTelegramClient } from './telegram.ts'

async function main(): Promise<void> {
  const args = parseBroadcastArgs(process.argv.slice(2))
  if (args === null) {
    console.error(
      'Usage: npm run broadcast -- --tuman "Urganch" --message "Matn..." [--send]\n' +
        '\nWithout --send this only prints what would happen.',
    )
    process.exitCode = 1
    return
  }

  const config = loadBotConfig()
  const store = createSupabaseStore(await getBotSupabase(config))
  const targets = await store.findBroadcastTargets(args.tuman)

  console.log('tuman      : ' + args.tuman)
  console.log('recipients : ' + targets.length)
  console.log('message    :\n' + args.message)

  if (targets.length === 0) {
    // The usual cause is spelling, and the fix is to see how it was typed in.
    const districts = await store.listDistricts()
    console.log('\nNobody to send to. Nothing sent.')
    console.log('Tumans on record: ' + (districts.length > 0 ? districts.join(', ') : '(none)'))
    return
  }

  if (!args.send) {
    console.log('\nDRY RUN — nothing sent. Add --send to actually send.')
    return
  }

  const telegram = createTelegramClient(config.telegramToken, config.pollTimeoutSeconds)
  const outcome = await sendAnnouncement(telegram, targets, args.message)
  console.log(
    '\nsent=' + outcome.sent + ' blocked=' + outcome.blocked + ' failed=' + outcome.failed,
  )
}

main().catch((caught: unknown) => {
  console.error(String(caught))
  process.exitCode = 1
})

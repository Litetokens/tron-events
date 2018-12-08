const chai = require('chai')
const chalk = require('chalk')
const _ = require('lodash')
const assert = chai.assert
const wait = require('../helpers/wait')
const tools = require('../helpers/tools')
const jlog = require('../helpers/jlog')
const Cache = require('../../src/store/Cache')
const cache = new Cache()

const txs = require('../fixtures/incomingTransactions')
for (let j = 0; j < txs.length; j++) {
  txs[j].raw_data = {}
}
const events = require('../fixtures/events')

const n = '\n'

async function stressTest() {

  console.log(n, chalk.blue('Stress Test'))

  await cache.redis.flushallAsync()

  let contractAddresses = {}
  let indexByTransactionID = {}

  let a = Date.now()
  console.log(n, chalk.bold('Saving', events.length, 'events in the cache'))
  console.log(n+'Contract addresses:')

  let promises = []

  for (let i = 0; i < events.length; i++) {
    const tx = events[i]
    if (!contractAddresses[tx.contract_address]) {
      contractAddresses[tx.contract_address] = 0
      console.log(tx.contract_address)
    }
    contractAddresses[tx.contract_address]++
    indexByTransactionID[tx.transaction_id] = i
    promises.push(cache.setEvent(tx))
  }

  await Promise.all(promises)

  console.log(n,chalk.bold('Saved in ', (b = Date.now()) - a, 'ms'))

  wait(1)

  promises = []

  for (let contractAddress in contractAddresses) {
    promises.push(cache.getEventsByContractAddress(contractAddress, null, null, null, 10000))
    // assert.equal(events.length, contractAddresses[contractAddress] < 20 ? contractAddresses[contractAddress] : 20)
  }

  const result = await Promise.all(promises)
  console.log(n,chalk.bold('Read in', Date.now() - b, 'ms'))

  process.exit(0)

}

stressTest()


//     )
//   })
// })
//
//   return
//
//   let db
//   const tx0 = txs[0]
//
//   before(async function () {
//
//     process.env.cacheDuration = 2
//
//     // db = require('../../src/db')
//     // await db.initPg()
//     // await db.pg.query('truncate events_log')
//
//   })
//
//   describe('stress test', function () {
//
//     let d
//
//     it('should write ~20,000 events and retrieve them by txid', async function () {
//
//       this.timeout(60000)
//       process.env.cacheDuration = 60
//
//       d = Date.now()
//       await db.pg.query('truncate events_log')
//
//       console.log('Generating promises...')
//       let promises = []
//       for (let i = 0; i < events.length; i++) {
//         events[i].raw_data = {}
//         promises.push(db.saveEvent(events[i]))
//       }
//       console.log('Saving...')
//       try {
//         await Promise.all(promises)
//             .then(() => {
//               console.log('Writing time', Date.now() - d, 'ms')
//             })
//       } catch(err) {
//         console.error(err)
//       }
//     })
//
//
//     it('should write ~20,000 events and retrieve them by txid, writing only in PG', async function () {
//
//       this.timeout(60000)
//
//       d = Date.now()
//       await db.pg.query('truncate events_log')
//
//       console.log('Generating promises...')
//       let promises = []
//       for (let i = 0; i < events.length; i++) {
//         events[i].raw_data = {}
//         promises.push(db.saveEvent(events[i], {onlyPg: 1}))
//       }
//       console.log('Saving...')
//       await Promise.all(promises)
//           .then(() => {
//             console.log('Writing time', Date.now() - d, 'ms')
//           })
//
//     })
//
//
//     it('should write ~20,000 events and retrieve them by txid, writing only in Redis', async function () {
//
//       process.env.totalMemoryUsedDuringTesting = 0
//       this.timeout(60000)
//
//       d = Date.now()
//       process.env.cacheDuration = 30
//
//       await db.pg.query('truncate events_log')
//
//       console.log('Generating promises...')
//       let promises = []
//       for (let i = 0; i < events.length; i++) {
//         events[i].raw_data = {}
//         promises.push(db.saveEvent(events[i], {onlyRedis: 1}))
//       }
//       console.log('Saving...')
//       await Promise.all(promises)
//           .then(() => {
//             console.log('Writing time', Date.now() - d, 'ms')
//           })
//
//       promises = []
//       d = Date.now()
//       for (let i = 0; i < events.length; i++) {
//         promises.push(db.getEventByTransactionID(events[i].transaction_id))
//         // console.log(result)
//       }
//       await Promise.all(promises)
//           .then(() => {
//             console.log('Reading time', Date.now() - d, 'ms')
//           })
//
//
//       console.log('Total space in memory', process.env.totalMemoryUsedDuringTesting)
//
//     })
//
//
//     it('should write ~20,000 compressed events and retrieve them by txid, writing only in Redis', async function () {
//
//       process.env.totalMemoryUsedDuringTesting = 0
//       this.timeout(60000)
//
//       d = Date.now()
//       process.env.cacheDuration = 30
//
//       await db.pg.query('truncate events_log')
//
//       console.log('Generating promises...')
//       let promises = []
//       for (let i = 0; i < events.length; i++) {
//         events[i].raw_data = {}
//         promises.push(db.saveEvent(events[i], {onlyRedis: 1, compressed: 1}))
//       }
//       console.log('Saving...')
//       await Promise.all(promises)
//           .then(() => {
//             console.log('Writing time', Date.now() - d, 'ms')
//           })
//
//       promises = []
//       d = Date.now()
//       for (let i = 0; i < events.length; i++) {
//         promises.push(db.getEventByTransactionID(events[i].transaction_id), true)
//         // console.log(result)
//       }
//       await Promise.all(promises)
//           .then(() => {
//             console.log('Reading time', Date.now() - d, 'ms')
//           })
//
//       console.log('Total space in memory', process.env.totalMemoryUsedDuringTesting)
//     })
//   })
//
// })
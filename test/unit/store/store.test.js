// const chai = require('chai')
//
// const _ = require('lodash')
// const assert = chai.assert
// const wait = require('../../helpers/wait')
// const tools = require('../../helpers/tools')
// const jlog = require('../../helpers/jlog')
// const cache = require('../../../src/store/cache')
//
// const txs = require('../../fixtures/incomingTransactions')
// for (let j=0;j<txs.length;j++) {
//   txs[j].raw_data = {}
// }
//
// const events = require('../../fixtures/events')
//
// describe('#cache', function () {
//
//   const tx0 = txs[0]
//
//   before(async function () {
//
//     process.env.cacheDuration = 2
//   })
//
//   describe('#toExpandedKeys', function () {
//
//     it('should return an object with short keys', function () {
//
//       assert.equal(cache.toExpandedKeys().b, 'block_number')
//
//     })
//
//   })
//
//   describe('#toCompressedKeys', function () {
//
//     it('should return an object with long keys', function () {
//
//       assert.equal(cache.toCompressedKeys().block_number, 'b')
//
//     })
//
//   })
//
//
//   describe('#compress', function () {
//
//     it('should compress a full transaction', function () {
//
//       const compressed = cache.compress(tx0)
//
//       assert.equal(compressed.b, tx0.block_number)
//       assert.equal(compressed.x, tx0.transaction_id)
//
//     })
//
//     it('should compress a filtered transaction', function () {
//
//       const compressed = cache.compress(tx0, ['transaction_id'])
//
//       assert.equal(compressed.b, tx0.block_number)
//       assert.isUndefined(compressed.x)
//     })
//
//   })
//
//   describe('#uncompress', function () {
//
//     it('should uncompress an event', function () {
//
//       const compressed = cache.compress(tx0)
//
//       const uncompressed = cache.uncompress(compressed)
//
//       assert.isTrue(_.isEqual(tx0, uncompressed))
//
//     })
//
//   })
//
//
//   describe('#formatKey', function () {
//
//     it('should format a valid key', function () {
//
//       const key = cache.formatKey(tx0, ['transaction_id', 'event_name'])
//       assert.equal(key, tx0.transaction_id + ':' + tx0.event_name)
//
//     })
//   })
//
//   describe('#setEventByTransactionID', function () {
//
//     it('should cache a compressed event by txID', async function () {
//
//       await cache.setEventByTransactionID(tx0, true)
//
//       const key = cache.formatKey(tx0, ['transaction_id'])
//       const subKey = cache.formatKey(tx0, ['event_name', 'event_index'])
//
//       const ttl = await cache.redis.ttlAsync(key)
//       assert.equal(ttl, process.env.cacheDuration)
//
//       const data = await cache.redis.hgetallAsync(key)
//
//
//       assert.isNotNull(data[subKey])
//
//       data[subKey] = JSON.parse(data[subKey])
//
//       assert.equal(data[subKey].b, tx0.block_number)
//
//
//     })
//
//     it('should cache a compressed event and verify that after the expiration time, it is no more in the cache', async function () {
//
//       this.timeout(4000)
//
//       const tx1 = txs[1]
//
//       await cache.setEventByTransactionID(tx1, true)
//
//       const key = cache.formatKey(tx0, ['transaction_id'])
//
//       let data = await cache.redis.hgetallAsync(key)
//       assert.equal(typeof data, 'object')
//
//       wait(3)
//       data = await cache.redis.hgetallAsync(key)
//       assert.isNull(data)
//     })
//
//     it('should cache multi non compressed events by the same txID', async function () {
//
//       let tx2 = _.clone(txs[2])
//       let tx4 = _.clone(txs[4])
//       tx4.transaction_id = tx2.transaction_id
//
//       const key = cache.formatKey(tx2, ['transaction_id'])
//
//       await cache.setEventByTransactionID(tx2)
//       await cache.setEventByTransactionID(tx4)
//
//       const subKey2 = cache.formatKey(tx2, ['event_name', 'event_index'])
//       const subKey4 = cache.formatKey(tx4, ['event_name', 'event_index'])
//
//       const data = await cache.redis.hgetallAsync(key)
//       assert.isNotNull(data[subKey2])
//       assert.isNotNull(data[subKey4])
//
//     })
//
//   })
//
//
//   describe('#setIndexByContractAddress', function () {
//
//     it('should cache an event by contract address', async function () {
//
//       const tx5 = txs[5]
//
//       await cache.setIndexByContractAddress(tx5)
//
//       const key = cache.formatKey(tx5, cache.fieldsByContractAddress.key)
//       const subKey = cache.formatKey(tx5, cache.fieldsByContractAddress.subKey)
//
//       const ttl = await cache.redis.ttlAsync(key)
//       assert.equal(ttl, process.env.cacheDuration)
//
//       const data = await cache.redis.hgetallAsync(key)
//       assert.isNotNull(data[subKey])
//
//       data[subKey] = JSON.parse(data[subKey])
//       assert.equal(data[subKey].transaction_id, tx5.transaction_id)
//
//     })
//
//   })
//
//
//   describe('#saveEvent', function () {
//
//     it('should save a single event', async function () {
//
//       const tx0 = txs[0]
//       await cache.saveEvent(txs[0])
//
//       const result = await cache.pg.query('select * from events_log')
//       assert.equal(result.rows[0].transaction_id, tx0.transaction_id)
//
//     });
//
//     it('should save multiple events by the same contract address', async function () {
//
//       let contract_address = 'TMYcx6eoRXnePKT1jVn25ZNeMNJ6828HWk'
//       let ckeys = {}
//
//       for (let i = 6; i < txs.length; i++) {
//         if (txs[i].contract_address === contract_address) {
//
//           console.log('\n\n\n', txs[i])
//           await cache.saveEvent(txs[i])
//           ckeys[cache.formatKey(txs[i], ['contract_address', 'event_name', 'block_number'])] = 1
//         }
//       }
//
//       const keys = await cache.redis.keysAsync(`${contract_address}:*`)
//       keys.sort(cache.sortKeysByBlockNumberDescent)
//
//       for (let i = 0; i < keys.length; i++) {
//         let key = keys[i].split(':')
//         let result = await cache.pg.query('select * from events_log where contract_address = $1 and block_number = $2', [key[0], key[1]])
//         assert.equal(result.rows[0].contract_address, key[0])
//       }
//     })
//   })
//
//   describe('#getEventByTransactionID', function () {
//
//     it('should cache uncompressed events and retrieve them by txid', async function () {
//       await cache.setEventByTransactionID(txs[8])
//       const result = await cache.getEventByTransactionID(txs[8].transaction_id)
//       assert.isTrue(tools.txEqual(txs[8], result))
//     })
//
//     it('should cache compressed events and retrieve them by txid', async function () {
//       await cache.setEventByTransactionID(txs[9], true)
//       const result = await cache.getEventByTransactionID(txs[9].transaction_id, true)
//
//       assert.isTrue(tools.txEqual(txs[9], result[0]))
//     })
//
//     it('should cache compressed and uncompressed events and verify that they are identical', async function () {
//       await cache.setEventByTransactionID(txs[8])
//       let result1 = await cache.getEventByTransactionID(txs[8].transaction_id)
//       await cache.setEventByTransactionID(txs[8], true)
//       let result2 = await cache.getEventByTransactionID(txs[8].transaction_id, true)
//       console.log(result1)
//       console.log(result2)
//       assert.isTrue(tools.txEqual(result1, result2))
//     })
//
//
//   })
//
// })
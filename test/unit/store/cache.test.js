const chai = require('chai')

const _ = require('lodash')
const assert = chai.assert
const wait = require('../../helpers/wait')
const tools = require('../../helpers/tools')
const jlog = require('../../helpers/jlog')
const cache = require('../../../src/store/cache')

const txs = require('../../fixtures/incomingTransactions')
for (let j = 0; j < txs.length; j++) {
  txs[j].raw_data = {}
}

const events = require('../../fixtures/events')

describe('#cache', function () {

  const tx0 = txs[0]

  before(async function () {

    process.env.cacheDuration = 2
  })

  beforeEach(async function () {

    let keys = await cache.redis.keysAsync('*')
    for (let key of keys) {
      await cache.redis.expireAsync(key, 0)
    }
  })


  describe('#toExpandedKeys', function () {

    it('should return an object with short keys', function () {

      assert.equal(cache.toExpandedKeys().b, 'block_number')

    })

  })

  describe('#toCompressedKeys', function () {

    it('should return an object with long keys', function () {

      assert.equal(cache.toCompressedKeys().block_number, 'b')

    })

  })


  describe('#compress', function () {

    it('should compress a full transaction', function () {

      const compressed = cache.compress(tx0)

      assert.equal(compressed.b, tx0.block_number)
      assert.equal(compressed.x, tx0.transaction_id)

    })

    it('should compress a filtered transaction', function () {

      const compressed = cache.compress(tx0, 'transaction_id')

      assert.equal(compressed.b, tx0.block_number)
      assert.isUndefined(compressed.x)
    })

  })

  describe('#uncompress', function () {

    it('should uncompress an event', function () {

      const key = cache.formatKey(tx0, cache.fieldsByTransactionID.key)
      const subKey = cache.formatKey(tx0, cache.fieldsByTransactionID.subKey)

      const compressed = cache.compress(tx0, cache.concatKeys(key, subKey))

      const uncompressed = cache.uncompress(compressed, cache.fieldsByTransactionID, key, subKey)

      assert.isTrue(tools.txEqual(tx0, uncompressed))

    })

  })


  describe('#formatKey', function () {

    it('should format a valid key', function () {

      const key = cache.formatKey(tx0, ['transaction_id', 'event_name'])
      assert.equal(key, tx0.transaction_id + ':' + tx0.event_name)

    })
  })

  describe('#setEventByTransactionID', function () {

    it('should cache a compressed event by txID', async function () {

      await cache.setEventByTransactionID(tx0, true)

      const key = cache.formatKey(tx0, cache.fieldsByTransactionID.key)
      const subKey = cache.formatKey(tx0, cache.fieldsByTransactionID.subKey)

      const ttl = await cache.redis.ttlAsync(key)
      assert.equal(ttl, process.env.cacheDuration)

      const data = await cache.redis.hgetallAsync(key)


      assert.isNotNull(data[subKey])

      data[subKey] = JSON.parse(data[subKey])

      assert.equal(data[subKey].b, tx0.block_number)


    })

    it('should cache a compressed event and verify that after the expiration time, it is no more in the cache', async function () {

      this.timeout(4000)

      const tx1 = txs[1]

      await cache.setEventByTransactionID(tx1, true)

      const key = cache.formatKey(tx0, cache.fieldsByTransactionID.key)

      let data = await cache.redis.hgetallAsync(key)
      assert.equal(typeof data, 'object')

      wait(3)
      data = await cache.redis.hgetallAsync(key)
      assert.isNull(data)
    })

    it('should cache multi non compressed events by the same txID', async function () {

      let tx2 = _.clone(txs[2])
      let tx4 = _.clone(txs[4])
      tx4.transaction_id = tx2.transaction_id

      const key = cache.formatKey(tx2, cache.fieldsByTransactionID.key)

      await cache.setEventByTransactionID(tx2)
      await cache.setEventByTransactionID(tx4)

      const subKey2 = cache.formatKey(tx2, ['event_name', 'event_index'])
      const subKey4 = cache.formatKey(tx4, ['event_name', 'event_index'])

      const data = await cache.redis.hgetallAsync(key)
      assert.isNotNull(data[subKey2])
      assert.isNotNull(data[subKey4])

    })

  })


  // describe('#setEventByContractAddress', function () {
  //
  //   it('should cache an event by contract address', async function () {
  //
  //     const tx5 = txs[5]
  //
  //     await cache.setEventByContractAddress(tx5)
  //
  //     const key = cache.formatKey(tx5, cache.fieldsByContractAddress.key)
  //     const subKey = cache.formatKey(tx5, cache.fieldsByContractAddress.subKey)
  //
  //     const ttl = await cache.redis.ttlAsync(key)
  //     assert.equal(ttl, process.env.cacheDuration)
  //
  //     const data = await cache.redis.hgetallAsync(key)
  //
  //     let event
  //     for (let sk in data) {
  //       if (!sk.indexOf(subKey)) {
  //         event = cache.uncompress(data[sk], cache.fieldsByContractAddress, key, sk)
  //         break
  //       }
  //     }
  //     assert.equal(event.transaction_id, tx5.transaction_id)
  //   })
  // })


  describe('#getEventByTransactionID', function () {

    it('should cache uncompressed events and retrieve them by txid', async function () {
      await cache.setEventByTransactionID(txs[8])
      const result = await cache.getEventByTransactionID(txs[8].transaction_id)
      assert.isTrue(tools.txEqual(txs[8], result[0]))
    })

    it('should cache compressed events and retrieve them by txid', async function () {
      await cache.setEventByTransactionID(txs[9], true)
      const result = await cache.getEventByTransactionID(txs[9].transaction_id)
      assert.isTrue(tools.txEqual(txs[9], result[0]))
    })

    it('should cache compressed and uncompressed events and verify that they are identical', async function () {
      await cache.setEventByTransactionID(txs[8])
      let result1 = await cache.getEventByTransactionID(txs[8].transaction_id)
      await cache.setEventByTransactionID(txs[8], true)
      let result2 = await cache.getEventByTransactionID(txs[8].transaction_id)
      assert.isTrue(tools.txEqual(result1, result2))
    })
  })

  return

  describe('#getEventByContractAddress', function () {

    it('should cache uncompressed events and retrieve them by contract address', async function () {
      await cache.setEventByContractAddress(txs[8])
      const result = await cache.getEventByContractAddress(txs[8].contract_address)
      assert.isTrue(tools.txEqual(txs[8], result[0]))
    })

    it('should cache compressed events and retrieve them contract address', async function () {
      await cache.setEventByContractAddress(txs[9], null, true)
      const result = await cache.getEventByContractAddress(txs[9].contract_address)
      assert.isTrue(tools.txEqual(txs[9], result[0]))
    })

    it('should cache compressed and uncompressed events and verify that they are identical', async function () {
      await cache.setEventByContractAddress(txs[8])
      let result1 = await cache.getEventByContractAddress(txs[8].contract_address)
      await cache.setEventByContractAddress(txs[8], true)
      let result2 = await cache.getEventByContractAddress(txs[8].contract_address)
      assert.isTrue(tools.txEqual(result1, result2))
    })

    it('should cache 10 compressed events and retrieve them by contract address and after other 5 using last hast', async function () {

      const total = 10

      const contractAddress = 'TMYcx6eoRXnePKT1jVn25ZNeMNJ6828HWk'
      const selected = []
      for (let i = 0; i < txs.length; i++) {
        let tx = txs[i]
        if (tx.contract_address === contractAddress) {
          selected.push(tx)
        }
      }
      for (let i = selected.length - 1; i >= 0; i--) {
        await cache.setEventByContractAddress(selected[i], true)
      }
      const result = await cache.getEventByContractAddress(contractAddress, null, null, null, total)
      let c = 0
      for (let r of result) {
        for (let i = 0; i < selected.length; i++) {
          if (selected[i].transaction_id === r.transaction_id) {
            assert.isTrue(tools.txEqual(selected[i], r))
            c++
          }
        }
      }
      let hash = result.pop().hash
      const result2 = await cache.getEventByContractAddress(contractAddress, null, null, null, total, 2, hash)

      // console.log(result2)




    })


  })

})
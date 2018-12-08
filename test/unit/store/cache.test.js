const chai = require('chai')

const _ = require('lodash')
const assert = chai.assert
const wait = require('../../helpers/wait')
const tools = require('../../helpers/tools')
const jlog = require('../../helpers/jlog')
const Cache = require('../../../src/store/Cache')
const cache = new Cache()

const txs = require('../../fixtures/incomingTransactions')
for (let j = 0; j < txs.length; j++) {
  txs[j].raw_data = {}
}

const events = require('../../fixtures/events')

describe('#cache', function () {

  async function resetRedis() {
    await cache.redis.flushallAsync()
  }

  const tx0 = txs[0]

  beforeEach(async function () {
    await resetRedis()
  })

  after(async function () {
    this.timeout(30000)
    await resetRedis()
  })


  describe('#toExpandedKeys', function () {

    it('should return an object with short keys', function () {

      assert.equal(Cache.toExpandedKeys().b, 'block_number')
    })

  })

  describe('#toCompressedKeys', function () {

    it('should return an object with long keys', function () {

      assert.equal(Cache.toCompressedKeys().block_number, 'b')

    })

  })


  describe('#compress', function () {

    it('should compress a full transaction', function () {

      const compressed = Cache.compress(tx0)

      assert.equal(compressed.b, tx0.block_number)
      assert.equal(compressed.x, tx0.transaction_id)

    })

    it('should compress a filtered transaction', function () {

      const compressed = Cache.compress(tx0, 'transaction_id')

      assert.equal(compressed.b, tx0.block_number)
      assert.isUndefined(compressed.x)
    })

  })

  describe('#uncompress', function () {

    it('should uncompress an event', function () {

      const key = Cache.formatKey(tx0, cache.fieldsByTransactionID.key)
      const subKey = Cache.formatKey(tx0, cache.fieldsByTransactionID.subKey)

      const compressed = Cache.compress(tx0, Cache.concatKeys(key, subKey))

      const uncompressed = Cache.uncompress(compressed, cache.fieldsByTransactionID, key, subKey)

      assert.isTrue(tools.txEqual(tx0, uncompressed))

    })

  })


  describe('#formatKey', function () {

    it('should format a valid key', function () {

      const key = Cache.formatKey(tx0, ['transaction_id', 'event_name'])
      assert.equal(key, tx0.transaction_id + ':' + tx0.event_name)

    })
  })

  describe('#timestampByBlockNumber', function () {

    it('should confirm that any event in the same block number has the same block timestamp (using 19928 events scraped from mainnet)', function () {

      const timestampByTransactionID = {}
      for (let tx of events) {
        if (!timestampByTransactionID[tx.block_number]) {
          timestampByTransactionID[tx.block_number] = tx.block_timestamp
        } else {
          assert.equal(timestampByTransactionID[tx.block_number], tx.block_timestamp)
        }
      }
    })

    it('should set the timestamp for a certain block number', async function () {

      cache.setTimestampByBlockNumber(txs[0])
      const timestamp = await cache.redis.hgetAsync('timestampByBlockNumber', txs[0].block_number)
      assert.equal(timestamp, txs[0].block_timestamp.toString())
    })

  })

  describe('#setEventByTransactionID', function () {

    it('should cache a compressed event by txID specify the cacheDuration', async function () {

      const cacheDuration = 1
      await cache.setEventByTransactionID(tx0, true, null, cacheDuration)

      const key = Cache.formatKey(tx0, cache.fieldsByTransactionID.key)
      const subKey = Cache.formatKey(tx0, cache.fieldsByTransactionID.subKey)

      const ttl = await cache.redis.ttlAsync(key)
      assert.equal(ttl, cacheDuration)

      const data = await cache.redis.hgetallAsync(key)


      assert.isNotNull(data[subKey])

      data[subKey] = JSON.parse(data[subKey])

      assert.equal(data[subKey].b, tx0.block_number)


    })

    it('should cache a compressed event and verify that after the expiration time, it is no more in the cache', async function () {

      this.timeout(4000)

      const tx1 = txs[1]

      const cacheDuration = 1
      await cache.setEventByTransactionID(tx1, true, null, cacheDuration)

      const key = Cache.formatKey(tx0, cache.fieldsByTransactionID.key)

      let data = await cache.redis.hgetallAsync(key)
      assert.equal(typeof data, 'object')

      wait(cacheDuration + 1)
      data = await cache.redis.hgetallAsync(key)
      assert.isNull(data)
    })

    it('should cache multi non compressed events by the same txID', async function () {

      let tx2 = _.clone(txs[2])
      let tx4 = _.clone(txs[4])
      tx4.transaction_id = tx2.transaction_id

      const key = Cache.formatKey(tx2, cache.fieldsByTransactionID.key)

      await cache.setEventByTransactionID(tx2)
      await cache.setEventByTransactionID(tx4)

      const subKey2 = Cache.formatKey(tx2, ['event_name', 'event_index'])
      const subKey4 = Cache.formatKey(tx4, ['event_name', 'event_index'])

      const data = await cache.redis.hgetallAsync(key)
      assert.isNotNull(data[subKey2])
      assert.isNotNull(data[subKey4])

    })

  })


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

  describe('#setIndexByContractAddress', function () {

    it('should set an index of events by contract address', async function () {

      let contractAddresses = {}
      let indexByTransactionID = {}

      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i]
        if (!contractAddresses[tx.contract_address]) {
          contractAddresses[tx.contract_address] = 0
        }
        contractAddresses[tx.contract_address]++
        indexByTransactionID[tx.transaction_id] = i
        await cache.setIndexByContractAddress(tx)
      }

      for (let contractAddress in contractAddresses) {
        let members = await cache.redis.zrevrangeAsync('$' + contractAddress, 0, contractAddresses[contractAddress], 'withscores')
        for (let i = 0; i < members.length; i += 2) {
          const tx = members[i]
          const ts = members[i + 1]
          const event = txs[indexByTransactionID[tx]]
          assert.equal(event.block_timestamp.toString(), ts)
        }
      }
    })
  })


  describe('#setEvent', function () {

    it('should set a compressed event and index it by contract address', async function () {

      await cache.setEvent(txs[8], true)

      let events = await cache.getEventByTransactionID(txs[8].transaction_id)
      assert.isTrue(tools.txEqual(txs[8], events[0]))

      events = await cache.getEventsByContractAddress(txs[8].contract_address)
      assert.isTrue(tools.txEqual(txs[8], events[0]))

    })

    describe('#getEventsByContractAddress', function () {

      beforeEach(async function () {
        this.timeout(10000)
        await resetRedis()
      })

      it('should get a list of events by contract address, size = 20, page 1', async function () {

        let contractAddresses = {}
        let indexByTransactionID = {}

        for (let i = 0; i < txs.length; i++) {
          const tx = txs[i]
          if (!contractAddresses[tx.contract_address]) {
            contractAddresses[tx.contract_address] = 0
          }
          contractAddresses[tx.contract_address]++
          indexByTransactionID[tx.transaction_id] = i
          await cache.setEvent(tx)
        }

        for (let contractAddress in contractAddresses) {
          const events = await cache.getEventsByContractAddress(contractAddress)
          assert.equal(events.length, contractAddresses[contractAddress] < 20 ? contractAddresses[contractAddress] : 20)
        }
      })

      // it('should get a list of events by contract address, size = 5, page 1, 2, 3...', async function () {
      //
      //   let contractAddresses = {}
      //   let indexByTransactionID = {}
      //
      //   for (let i = 0; i < events.length; i++) {
      //     const tx = events[i]
      //     if (!contractAddresses[tx.contract_address]) {
      //       contractAddresses[tx.contract_address] = 0
      //     }
      //     contractAddresses[tx.contract_address]++
      //     indexByTransactionID[tx.transaction_id] = i
      //     await cache.setEvent(tx)
      //   }
      //
      //   for (let contractAddress in contractAddresses) {
      //     const events = await cache.getEventsByContractAddress(contractAddress)
      //     assert.equal(events.length, contractAddresses[contractAddress] < 20 ? contractAddresses[contractAddress] : 20)
      //   }
      //
      // })
    })

  })

})
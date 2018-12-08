const bluebird = require('bluebird')
const redis = require('redis')
const _ = require('lodash')

const config = require('../config')

bluebird.promisifyAll(redis.RedisClient.prototype)
bluebird.promisifyAll(redis.Multi.prototype)

const BLOCK_NUMBER = 'b'
const BLOCK_TIMESTAMP = 't'
const CONTRACT_ADDRESS = 'a'
const EVENT_INDEX = 'i'
const EVENT_NAME = 'n'
const RESULT = 'r'
const RESULT_TYPE = 'e'
const TRANSACTION_ID = 'x'
const RESOURCE_NODE = 's'
const RAW_DATA = 'w'

const UNCONFIRMED_PREFIX = '@'

const toCompressedKeys = {
  block_number: BLOCK_NUMBER,
  block_timestamp: BLOCK_TIMESTAMP,
  contract_address: CONTRACT_ADDRESS,
  event_index: EVENT_INDEX,
  event_name: EVENT_NAME,
  result: RESULT,
  result_type: RESULT_TYPE,
  transaction_id: TRANSACTION_ID,
  resource_Node: RESOURCE_NODE,
  raw_data: RAW_DATA
}

const numberKeys = {
  block_number: 1,
  block_timestamp: 1,
  event_index: 1
}


const returnCodes = {
  ERROR: 0,
  SET_UNCONFIRMED: 1,
  SET_CONFIRMED: 2,
  ALREADY_SET: 3,
  SET_FORCED_CONFIRMED: 4
}

const toExpandedKeys = _.invert(toCompressedKeys)

class Cache {

  constructor() {
    try {
      this.redis = redis.createClient(config.redis.port, config.redis.host)
    } catch (e) {
      console.error('Redis connection failed.')
    }

    this.fieldsByTransactionID = {
      key: ['transaction_id'],
      subKey: ['event_name', 'event_index']
    }

    this.fieldsByContractAddress = [
      {
        key: ['contract_address'],
        member: ['transaction_id']
      }, {
        key: ['contract_address', 'event_name'],
        member: ['transaction_id']
      }
    ]
  }

  async getEventStatus(eventHash) {
    return this.redis.getAsync(eventHash)
  }

  async setEventStatusAsUnconfirmed(eventHash) {
    return this.redis.setAsync(eventHash, 1)
  }

  async setEventStatusAsConfirmed(eventHash) {
    return this.redis.setAsync(eventHash, 2)
  }

  async setEventByTransactionID(
      eventData,
      compressed,
      forceAsConfirmed,
      cacheDuration = config.defaultCacheDuration
  ) {

    const key = Cache.formatKey(eventData, this.fieldsByTransactionID.key)
    const subKey = Cache.formatKey(eventData, this.fieldsByTransactionID.subKey)
    const eventHash = Cache.eventFingerprint(eventData)
    const itExists = forceAsConfirmed ? 0 : await this.getEventStatus(eventHash)
    if (itExists === '1') {
      await this.setEventStatusAsConfirmed(eventHash)
      return Promise.resolve(returnCodes.SET_CONFIRMED)
    } else if (itExists === '2') {
      return Promise.resolve(returnCodes.ALREADY_SET)
    } else {
      const event = compressed
          ? Cache.compress(eventData, Cache.concatKeys(key, subKey))
          : eventData

      {
        // used during stress tests
        !process.env.totalMemoryUsedDuringTesting || (process.env.totalMemoryUsedDuringTesting = parseInt(process.env.totalMemoryUsedDuringTesting) + event.length)
      }

      await Promise.all([
        this.redis.hset(key, subKey, JSON.stringify(event)),
        forceAsConfirmed
            ? this.setEventStatusAsConfirmed(eventHash)
            : this.setEventStatusAsUnconfirmed(eventHash)
      ])
      this.redis.expire(key, cacheDuration)
      this.redis.expire(eventHash, cacheDuration)

      return Promise.resolve(forceAsConfirmed ? returnCodes.SET_FORCED_CONFIRMED : returnCodes.SET_UNCONFIRMED)
    }
  }

  setTimestampByBlockNumber(eventData) {
    this.redis.hset('timestampByBlockNumber', eventData.block_number, eventData.block_timestamp)
  }

  async getEventByTransactionID(transactionID, onlyConfirmed) {

    const result = []
    let events = await this.redis.hgetallAsync(transactionID)
    if (events) {
      for (let subKey in events) {
        let event = JSON.parse(events[subKey])
        if (event.r) {
          event = Cache.uncompress(event, this.fieldsByTransactionID, transactionID, subKey)
        }
        if (onlyConfirmed) {
          if (Cache.eventFingerprint(event) !== '2') {
            continue
          }
        }
        result.push(event)
      }
    }
    return Promise.resolve(result)
  }

  getLastElementOfKey(key) {
    return key.replace(/.*:([^:]+)$/, "$1")
  }

  async setEvent(
      eventData,
      compressed,
      forceAsConfirmed,
      cacheDuration = config.defaultCacheDuration
  ) {

    const result = await this.setEventByTransactionID(eventData, compressed, forceAsConfirmed, cacheDuration)
    if (result === returnCodes.SET_UNCONFIRMED || result === returnCodes.SET_FORCED_CONFIRMED) {
      this.setIndexByContractAddress(eventData)
      this.setTimestampByBlockNumber(eventData)
    }
  }

  setIndexByContractAddress(eventData) {
    for (let fields of this.fieldsByContractAddress) {
      const key = '$' + Cache.formatKey(eventData, fields.key)
      const member = Cache.formatKey(eventData, fields.member)
      this.redis.zadd(key, eventData.block_timestamp, member)
    }
  }

  async getSortedSetMembers(key, start, stop) {
    let members = await this.redis.zrevrangeAsync(key, start, stop, 'withscores')
    return Promise.resolve(members)
  }

  cleanIndexes(blockTimestamp) {
    // zremrangebyscore(key, '-inf', blockTimestamp)
  }

  async getEventsByContractAddress(
      contractAddress,
      sinceBlockTimestamp = false,
      blockNumber,
      eventName,
      size = config.defaultSize,
      page = 1,
      previousFingerprint,
      onlyConfirmed
  ) {
    let events = []
    let start = page === 1 ? 0 : size * (page - (previousFingerprint ? 2 : 1))
    let stop = start + size + (page === 1 || !previousFingerprint ? 0 : 1)
    let previousFound = false
    let key = '$' + contractAddress + (eventName ? ':' + eventName : '')
    let members = await this.getSortedSetMembers(key, start, stop)
    LOOP: while (true) {
      if (!members.length) {
        break
      }
      for (let i = 0; i < members.length; i += 2) {
        const transactionID = members[i]
        const blockTimestamp = parseInt(members[i + 1])
        if (sinceBlockTimestamp && sinceBlockTimestamp < blockTimestamp) {
          break LOOP
        }
        const events0 = await this.getEventByTransactionID(transactionID, onlyConfirmed)
        for (let event0 of events0) {
          if (previousFingerprint && !previousFound) {
            const fingerprint = Cache.eventFingerprint(event0)
            if (previousFingerprint === fingerprint) {
              previousFound = true
              if (i < members.length - 1) {
                continue
              } else {
                continue LOOP
              }
            }
          }
          events.push(event0)
          if (events.length >= size) {
            break LOOP
          }
        }
      }
      if (events.length < size) {
        start = stop
        stop = start + size - events.length
        members = await this.getSortedSetMembers(key, start, stop)
      }
    }
    return Promise.resolve(events)
  }


  // static methods


  static toExpandedKeys() {
    return toExpandedKeys
  }

  static toCompressedKeys() {
    return toCompressedKeys
  }

  static compress(eventData, exclude = '') {
    const compressed = {}
    const toCompressedKeys = Cache.toCompressedKeys()
    exclude = exclude.split(':')
    for (let k in toCompressedKeys) {
      if (!~exclude.indexOf(k)) {
        compressed[toCompressedKeys[k]] = eventData[k]
      }
    }
    return compressed
  }

  static uncompress(
      compressedData,
      fields,
      key,
      subKey
  ) {
    const expanded = {}
    const keys = Cache.toExpandedKeys()
    if (typeof compressedData === 'string') {
      compressedData = JSON.parse(compressedData)
    }
    for (let k in keys) {
      expanded[keys[k]] = compressedData[k]
    }
    key = key.split(':')
    for (let i = 0; i < fields.key.length; i++) {
      let field = fields.key[i]
      expanded[field] = numberKeys[field] ? parseInt(key[i]) : key[i]
    }
    subKey = subKey.split(':')
    for (let i = 0; i < fields.subKey.length; i++) {
      let field = fields.subKey[i]
      expanded[field] = numberKeys[field] ? parseInt(subKey[i]) : subKey[i]
    }
    return expanded
  }

  static formatKey(eventData, keys) {
    let key = ''
    for (let k of keys) {
      key += (key ? ':' : '') + eventData[k]
    }
    return key
  }

  static eventFingerprint(eventData) {
    let chars = []
    for (let i = 0; ; i++) {
      if (i < 8) {
        chars.push(eventData.contract_address.charAt(i + 2))
        if (i === 7) chars.push(':')
      } else if (i < 16) {
        chars.push(eventData.transaction_id.charAt(i - 6))
        if (i === 15) chars.push(':')
      } else {
        let c = eventData.event_name.charAt(i - 16)
        if (!c) break
        chars.push(c)
      }
    }
    chars.push(':' + eventData.event_index)
    return chars.join('')
  }

  static concatKeys(key, subKey) {
    return key + ':' + subKey
  }

}

module.exports = Cache


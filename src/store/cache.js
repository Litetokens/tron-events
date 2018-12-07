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
  ALREADY_SET: 0,
  SET_UNCONFIRMED: 1,
  SET_CONFIRMED: 2,
  ERROR: 3
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

    this.fieldsByContractAddress = {
      key: ['contract_address', 'event_name', 'block_number', 'block_timestamp'],
      subKey: ['event_index', 'transaction_id']
    }
  }

  toExpandedKeys() {
    return toExpandedKeys
  }

  toCompressedKeys() {
    return toCompressedKeys
  }

  compress(eventData, exclude = '') {
    const compressed = {}
    const toCompressedKeys = this.toCompressedKeys()
    exclude = exclude.split(':')
    for (let k in toCompressedKeys) {
      if (!~exclude.indexOf(k)) {
        compressed[toCompressedKeys[k]] = eventData[k]
      }
    }
    return compressed
  }

  uncompress(compressedData, fields, key, subKey) {
    const expanded = {}
    const keys = this.toExpandedKeys()
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

  formatKey(eventData, keys) {
    let key = ''
    for (let k of keys) {
      key += (key ? ':' : '') + eventData[k]
    }
    return key
  }

  unconfirmedSubkey(key) {
    return UNCONFIRMED_PREFIX + key
  }

  sortKeysByBlockNumberDescent(a, b) {
    const A = parseInt(a.split(':')[1])
    const B = parseInt(b.split(':')[1])
    if (A < B) return 1;
    if (A > B) return -1;
    return 0;
  }

  fingerprintEvent(eventData, prefix) {
    let chars = [prefix]
    for (let i = 0;; i++) {
      if (i < 6) {
        chars.push(eventData.contract_address.charAt(i + 2))
      } else if (i < 16) {
        chars.push(eventData.transaction_id.charAt(i - 6))
      } else {
        let c = eventData.event_name.charAt(i - 16)
        if (!c) break
        chars.push(c)
      }
    }
    chars.push(':' + eventData.event_index)
    return chars.join('')
  }

  concatKeys(key, subKey) {
    return key + ':' + subKey
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

  async setEventByTransactionID(eventData, compressed) {

    const key = this.formatKey(eventData, this.fieldsByTransactionID.key)
    const subKey = this.formatKey(eventData, this.fieldsByTransactionID.subKey)
    const eventHash = this.fingerprintEvent(eventData)
    const itExists = await this.getEventStatus(eventHash)
    if (itExists === '1') {
      await this.setEventStatusAsConfirmed(eventHash)
      return Promise.resolve(returnCodes.SET_CONFIRMED)
    } else if (itExists === '2') {
      return Promise.resolve(returnCodes.ALREADY_SET)
    } else {
      const event = compressed
          ? this.compress(eventData, this.concatKeys(key, subKey))
          : eventData

      {
        // used during stress tests
        !process.env.totalMemoryUsedDuringTesting || (process.env.totalMemoryUsedDuringTesting = parseInt(process.env.totalMemoryUsedDuringTesting) + event.length)
      }

      await Promise.all([
        this.redis.hsetAsync(key, subKey, JSON.stringify(event)),
        this.setEventStatusAsUnconfirmed(eventHash)
      ])
      await Promise.all([
        this.redis.expireAsync(key, process.env.cacheDuration || 3600),
        this.redis.expireAsync(eventHash, process.env.cacheDuration || 3600)
      ])
      return Promise.resolve(returnCodes.SET_UNCONFIRMED)
    }
  }

  async getEventByTransactionID(key, onlyConfirmed) {

    const result = []
    let events = await this.redis.hgetallAsync(key)
    if (events) {
      for (let subKey in events) {
        let event = JSON.parse(events[subKey])
        if (event.r) {
          event = this.uncompress(event, this.fieldsByTransactionID, key, subKey)
        }
        if (onlyConfirmed) {
          if (this.fingerprintEvent(event) !== '2') {
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

  filterKeysByBlockTimestamp(keys, blockTimestamp) {
    let res = []
    for (let i = 0; i < keys.length; i++) {
      let timestamp = parseInt(this.getLastElementOfKey(keys[i]))
      if (timestamp >= blockTimestamp) {
        res.push(keys[i])
      }
    }
    return res
  }

  async setEventByContractAddress(eventData, compressed) {

    const key = this.formatKey(eventData, this.fieldsByContractAddress.key)
    let subKey = this.formatKey(eventData, this.fieldsByContractAddress.subKey)

    const unconfirmedSubkey = this.unconfirmedSubkey(subKey)
    const itExists = await this.redis.hgetAsync(key, subKey)
    let returnCode = returnCodes.SET_UNCONFIRMED
    if (itExists) {
      let isUnconfirmed = await this.redis.hgetAsync(key, unconfirmedSubkey)
      if (isUnconfirmed) {
        await this.redis.hdelAsync(key, unconfirmedSubkey)
        returnCode = returnCodes.SET_CONFIRMED
      } else {
        return Promise.resolve(returnCodes.ALREADY_SET)
      }
    } else {
      const event = compressed
          ? this.compress(eventData, this.concatKeys(key, subKey))
          : eventData

      {
        // used during stress tests
        !process.env.totalMemoryUsedDuringTesting || (process.env.totalMemoryUsedDuringTesting = parseInt(process.env.totalMemoryUsedDuringTesting) + event.length)
      }

      const data = {}
      data[subKey] = JSON.stringify(event)
      data[unconfirmedSubkey] = 1
      await this.redis.hmsetAsync(
          key,
          data
      )
    }
    await this.redis.expireAsync(key, process.env.cacheDuration || 3600)
    return Promise.resolve(returnCode)

  }

  async getEventByContractAddress(address, since = false, blockNumber, eventName, size = 20, page = 1, previousLast, onlyConfirmed) {

    let keys = await this.redis.keysAsync(`${address}:${blockNumber || '*' }:${eventName || '*'}`)
    if (since) {
      keys = this.filterKeysByBlockTimestamp(keys, since)
    }
    let lastHash
    keys.sort(this.sortKeysByBlockNumberDescent)
    const result = []
    let count = 0
    let started = false
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i]
      let events = await this.redis.hgetallAsync(key)
      for (let subKey in events) {
        let eventHash = this.getLastElementOfKey(subKey)

        console.log(eventHash, previousLast, eventHash === previousLast)
        if (!started) {
          if (!previousLast) {
            started = true
          } else if (previousLast === eventHash) {
            started = true
            continue
          } else {
            continue
          }
        }
        let event = JSON.parse(events[subKey])
        if (event.r) {
          event = this.uncompress(event, this.fieldsByContractAddress, key, subKey)
        }
        result.push(event)
        lastHash = eventHash
        if (++count >= size) {
          break
        }
      }
    }
    if (result.length) {
      result[result.length - 1].eventHash = lastHash
    }

    return Promise.resolve(result)
  }

}

module.exports = new Cache


const _ = require('lodash')
const db = require('./db')
const cache = require('./cache')

class Store {

  constructor() {
    this.cache = cache
    this.db = db

  }

  async saveEvent(eventData, options = {}) {

    const hash = this.hashEvent(eventData)

    const returnCode0 = await this.setEventByTransactionID(eventData, options.compressed)
    const returnCode = await this.setIndexByContractAddress(eventData, hash, options.compressed)

    if (returnCode0 !== returnCode) {
      // TODO Should we alert some way?
      // It is just possible that one key expired some nano seconds before the other
    }

    let text
    let values

    if (returnCode === returnCodes.SET_CONFIRMED) {
      text = 'update events_log set confirmed = true where transaction_id=$1 and event_name = $3 and event_index = $4'
      values = [eventData.transaction_id, eventData.event_name, eventData.event_index]
    } else if (returnCode === returnCodes.SET_UNCONFIRMED) {
      text = 'insert into events_log(block_number, block_timestamp, contract_address, event_index, event_name, result, result_type, transaction_id, resource_Node, raw_data, hash) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *'
      values = Object.keys(toCompressedKeys).map(elem => eventData[elem])
      values.push(hash)
    }

    let result
    try {
      result = !text ? false // returnCode is ALREADY_SET or ERROR
          : options.onlyRedis ? true // option for testing
              : await this.pg.query(text, values)
                  .catch(err => {
                    if (/duplicate key/.test(err.message)) {
                      return Promise.resolve('duplicate key')
                    }
                    return Promise.reject(err)
                  })
    } catch (err) {
      result = err
    }
    return Promise.resolve(result)
  }


}

module.exports = new Store


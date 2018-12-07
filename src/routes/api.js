const express = require('express')
const router = express.Router()
const utils = require('../utils')
const store = require('../store')
const auth = require('../utils/auth')

router.get('/', async function (req, res) {
  res.json({
    name: 'TronEvents API',
    version: require('../../package').version
  })
})
//
// router.get('/init', auth, async function (req,res) {
//   const log = await store.initPg()
//   res.json({
//     success: true,
//     log
//   })
// })
//
// router.post('/events', auth, async function (req, res) {
//
//   let key = req.body.key
//   let eventData = req.body.data
//   try {
//     eventData = utils.parseString(eventData)
//   } catch(err) {
//     res.json({
//       success: false,
//       error: 'Malformed event data'
//     })
//   }
//
//   const result = await store.saveEvent(eventData)
//   res.json({
//     success: true,
//     result
//   })
//
// })
//
// router.get('/events/transaction/:id', async function (req, res) {
//
//   try {
//     const result = await store.getEventByTransactionID(req.params.id)
//     res.json({
//       success: true,
//       result
//     })
//   } catch(err) {
//     res.json({
//       success: false,
//       error: err.message
//     })
//   }
//
// })


module.exports = router

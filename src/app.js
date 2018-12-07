const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')

const pino = require('pino')
const logger = pino(pino.destination(path.resolve(__dirname, '../logs/tron-events.log')))
const expressPino = require('express-pino-logger')({
  logger,
  // we log only errors to increase performances
  level: "error"
})

process.on('uncaughtException', function (error) {
  logger(error.message)
})

const api = require('./routes/api')

const app = express();
app.use(expressPino)
app.use(bodyParser.json())

app.use('/api', api)

app.use('/favicon.ico', function (req, res) {
  res.send('')
})

app.all('*', function (req, res) {
  req.path === '/'
      ? res.redirect('/api')
      : res.json({
        error: 404,
        message: 'Not found.'
      })
})

module.exports = app

const chalk = require('chalk')
const app = require('./src/app')

app.listen(8060);

console.log('TronEvents listening on', chalk.bold('http://127.0.0.1:8060'))


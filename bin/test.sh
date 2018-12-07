#!/usr/bin/env bash

bin/reset-dbs.sh
source .default.env && NODE_ENV=test node_modules/.bin/mocha 'test/**/*.test.js' --exit

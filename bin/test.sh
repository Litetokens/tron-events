#!/usr/bin/env bash

REDIS_IS=$(bin/is-running.sh tron-redis)
PG_IS=$(bin/is-running.sh tron-postgres)

if [[ $REDIS_IS != "2" ]]; then
  if [[ $REDIS_IS == "1" ]]; then
    echo "Starting redis"
    bin/redis.sh
  elif [[ $REDIS_IS == "3" ]]; then
    echo "Restarting redis"
    docker restart tron-redis
  fi
else
  echo "Redis is running"
fi

if [[ $PG_IS != "2" ]]; then
  if [[ $PG_IS == "1" ]]; then
    echo "Starting postgres"
    bin/postgres.sh
  elif [[ $PG_IS == "3" ]]; then
    echo "Restarting postgres"
    docker restart tron-postgres
  fi
else
  echo "Postgres is running"
fi

source .default.env && NODE_ENV=test node_modules/.bin/mocha 'test/**/*.test.js' --exit

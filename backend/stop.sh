#!/usr/bin/env bash

PORT=8080

# Find all PIDs using the specified port
PIDS=$(lsof -t -i:$PORT)

if [ -z "$PIDS" ]; then
  echo "No process is running on port $PORT."
else
  echo "Stopping all processes on port $PORT..."
  for PID in $PIDS; do
    echo "Stopping process with PID $PID"
    kill $PID
  done
  echo "All processes on port $PORT have been stopped."
fi

#!/usr/bin/env bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd "$SCRIPT_DIR" || exit

PID_FILE=webui.pid

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p $PID > /dev/null; then
    echo "Stopping uvicorn with PID $PID"
    kill $PID
    rm "$PID_FILE"
    echo "uvicorn stopped."
  else
    echo "No running uvicorn process found with PID $PID."
    rm "$PID_FILE"
  fi
else
  echo "PID file not found. Is uvicorn running?"
fi
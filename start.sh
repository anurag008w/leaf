#!/bin/bash
cd "$(dirname "$0")"
export ZONE_USERNAME="${ZONE_USERNAME:-admin}"
if [ -z "$ZONE_PASSWORD" ]; then
  ZONE_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))") || { echo "failed to generate ZONE_PASSWORD"; exit 1; }
  export ZONE_PASSWORD
  echo "⚠️  ZONE_PASSWORD not set — generated random password: $ZONE_PASSWORD"
  echo "   Save this if you need to log in later."
fi
PORT=7860

# Check if port is in use using /dev/tcp (bash built-in)
timeout 1 bash -c "echo >/dev/tcp/127.0.0.1/$PORT" 2>/dev/null
if [ $? -eq 0 ]; then
  echo "Server already running on port $PORT."
  read -p "Kill and restart? (y/N): " choice
  case "$choice" in
    y|Y)
      fuser -k "$PORT/tcp" 2>/dev/null || true
      sleep 1
      ;;
    *)
      echo "Exiting."
      exit 0
      ;;
  esac
fi

echo "Starting Zone Study OS Server..."
echo "URL: http://localhost:$PORT"
echo "-----------------------------------"

python3 -m uvicorn app.main:app --host 0.0.0.0 --port $PORT &
SERVER_PID=$!
sleep 1
xdg-open "http://localhost:$PORT" 2>/dev/null || true
wait $SERVER_PID

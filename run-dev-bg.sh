#!/bin/bash
cd /home/user/webapp
npx wrangler pages dev dist --ip 0.0.0.0 --port 3000 --compatibility-date=2024-01-01 > /tmp/wrangler-out.log 2>&1 &
echo $! > /tmp/wrangler-bg.pid
sleep 2
# Wait for port
count=0
while ! ss -tlnp | grep -q ':3000'; do
  sleep 1
  count=$((count+1))
  if [ $count -gt 15 ]; then
    echo "Timeout waiting for port 3000"
    exit 1
  fi
done
echo "READY"

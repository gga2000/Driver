# Redis 7 for BullMQ on Fly (deploy/fly/redis.toml). BullMQ needs `noeviction` (an evicted job key
# is a lost timer); AOF every second keeps queued jobs across a restart; listens on IPv6 because
# Fly's private network (.internal) is IPv6-only. REDIS_PASSWORD comes from `flyctl secrets`.
FROM redis:7.4-alpine
CMD ["sh", "-c", "exec redis-server --bind '* -::*' --port 6379 --protected-mode no --requirepass \"$REDIS_PASSWORD\" --dir /data --appendonly yes --appendfsync everysec --maxmemory 180mb --maxmemory-policy noeviction"]

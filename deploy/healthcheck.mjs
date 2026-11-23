// Container-Healthcheck ohne Shell (Distroless): prüft /api/health
const res = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
process.exit(res && res.ok ? 0 : 1);

# Running Tablekeeper Stage 1

## Local

```bash
node src/server.js
# -> listening on 0.0.0.0:8080
```

## Docker

```bash
docker build -t tablekeeper-stage1 .
docker run --rm -e PORT=8080 -p 8080:8080 tablekeeper-stage1
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8080`  | Host:port to listen on (binds `0.0.0.0`) |

## Health

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

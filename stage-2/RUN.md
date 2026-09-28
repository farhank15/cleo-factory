# Running Tablekeeper Stage 2

## Local

```bash
node src/server.js
# -> listening on 0.0.0.0:8080
```

## Docker

```bash
docker build -t tablekeeper-stage2 stage-2
docker run --rm -e PORT=8080 -p 8080:8080 tablekeeper-stage2
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

## UI Screens

| Route | Screen |
|-------|--------|
| `/` | Search and availability grid |
| `/signup` | Signup |
| `/login` | Login |
| `/lookup` | Reservation lookup |
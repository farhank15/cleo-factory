# Tablekeeper Stage 1 — how to build and run

Stage 1 is a self-contained Node.js service with **no npm dependencies**. It only
uses Node built-ins (`http`, `crypto`, `Intl`), so it builds and runs with no
network access at build time or at runtime.

## Build

```sh
docker build -t tablekeeper-stage1 .
```

## Run (host mode, for local testing)

```sh
docker run --rm -e PORT=8080 -p 8080:8080 tablekeeper-stage1
```

The service listens on `0.0.0.0:$PORT` (default `8080`).

## Run (isolated mode, as the graded harness runs it)

```sh
docker run --rm --network=none -e PORT=8080 -p 127.0.0.1:8080:8080 tablekeeper-stage1
```

`--network=none` mirrors the harness's internal network: the container gets no
route off the host at runtime, which is how "no outbound at run time" is
enforced. Because the service has no network dependency, this still serves
`/health`.

## Smoke check

```sh
curl -s http://localhost:8080/health   # -> {"status":"ok"}
```

## Local development (without Docker)

```sh
npm start          # node src/app.js  (listens on $PORT or 8080)
node --test test/  # (none yet; run the Python harness suite instead)
```

## Verifying against the harness

From the `dark-factory-wearedevs` checkout:

```sh
PYTHONPATH=.:../.. python -m harness run --track tablekeeper --stage 1 --mode isolated
```

which builds the Dockerfile above and runs the Stage 1 pytest suite against the
containerised service.

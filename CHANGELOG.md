# Changelog

## [0.14.1](https://github.com/aminqp/workerkit/compare/v0.14.0...v0.14.1) (2026-08-31)

### Bug Fixes

- implement dynamic thread scaling for partitioned workers based on chunk count ([8018b33](https://github.com/aminqp/workerkit/commit/8018b33aa3b5825c545ca3a65585e481181ce3d3))

### Features

- add collectResults method and improve worker error handling and lifecycle management ([5f33b03](https://github.com/aminqp/workerkit/commit/5f33b0363400f705d23ab572b67997eda4436bb7))
- implement transparent memory reference passing for offloading large datasets between workers ([9d985e1](https://github.com/aminqp/workerkit/commit/9d985e14822cfa41f1e60dae01d0b4c01519b5e5))

# [0.14.0](https://github.com/aminqp/workerkit/compare/v0.13.0...v0.14.0) (2026-08-14)

### Features

- **worker:** add `defineWorker` helper for native Web Worker compatibility ([ce9b592](https://github.com/aminqp/workerkit/commit/ce9b592d14998fe8afb4c4e83ad73db9b8392782))

# [0.13.0](https://github.com/aminqp/workerkit/compare/v0.12.3...v0.13.0) (2026-08-13)

### Features

- **main-worker-factory:** add terminate, destroy, reset, and restart lifecycle methods ([0248946](https://github.com/aminqp/workerkit/commit/0248946e42a40867fc42a41c50cf94d3ec304ff2))

## [0.12.3](https://github.com/aminqp/workerkit/compare/v0.12.2...v0.12.3) (2026-08-13)

### Features

- add workerInstance option to WorkerFactory to allow using existing worker instances ([2f2e34b](https://github.com/aminqp/workerkit/commit/2f2e34b311a648b2067bbe83ea562f83e1314d04))

## [0.12.2](https://github.com/aminqp/workerkit/compare/v0.12.1...v0.12.2) (2026-08-13)

## [0.12.1](https://github.com/aminqp/workerkit/compare/v0.12.0...v0.12.1) (2026-08-13)

# [0.12.0](https://github.com/aminqp/workerkit/compare/v0.11.0...v0.12.0) (2026-08-13)

### Features

- **worker-factory:** allow `workerURL` option to accept `URL` instances ([e9f6cb9](https://github.com/aminqp/workerkit/commit/e9f6cb9fd01f159e7bb049cf3e5d2eca2c5bfe4f))

# [0.11.0](https://github.com/aminqp/workerkit/compare/v0.10.0...v0.11.0) (2026-05-31)

### Features

- **persistent:** add persistent worker examples and benchmarks ([c339e06](https://github.com/aminqp/workerkit/commit/c339e069bea029cdd5cb2ed22b90b67290238c45))

# [0.10.0](https://github.com/aminqp/workerkit/compare/v0.9.2...v0.10.0) (2026-05-27)

### Features

- **pipeline:** add worker-to-worker pipeline with MessageChannel support ([2344607](https://github.com/aminqp/workerkit/commit/2344607be687b77037fafe28ec728539eb2913c7))

## [0.9.2](https://github.com/aminqp/workerkit/compare/v0.9.1...v0.9.2) (2026-05-27)

## [0.9.1](https://github.com/aminqp/workerkit/compare/v0.9.0...v0.9.1) (2026-05-27)

# [0.9.0](https://github.com/aminqp/workerkit/compare/v0.8.9...v0.9.0) (2026-05-27)

### Features

- **worker-factory:** remove initiator pattern and simplify API ([f0e99c6](https://github.com/aminqp/workerkit/commit/f0e99c6d2ddfe0eb4195bd188fe439044b98f384))

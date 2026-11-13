// Source-tree shim: the one implementation is libs/truck-log/rxo-shared/process-lock.mjs.
// Both RXO images build from the repository root and COPY that file over this
// shim (see the Dockerfile), so in-image imports resolve to the real module.
export * from '../../../../libs/truck-log/rxo-shared/process-lock.mjs';

/**
 * Sizes the libuv thread pool to the vCPU count (hosting-2 guide, "Thread pool").
 *
 * ES module imports run in order, so each entry point imports this module FIRST:
 * it sets `UV_THREADPOOL_SIZE` before any other module, `zlib` or `fs` call can
 * start the pool. Brotli compression (Requirement 8.4) runs on that pool.
 */
import { availableParallelism } from "node:os";

process.env.UV_THREADPOOL_SIZE = String(availableParallelism());

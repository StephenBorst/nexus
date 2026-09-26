import process from "process";
import { Buffer } from "buffer";

(process as { env?: NodeJS.ProcessEnv }).env ??= {};

const g = globalThis as typeof globalThis & { process?: typeof process; Buffer?: typeof Buffer; global?: typeof globalThis };
g.process ??= process;
g.Buffer ??= Buffer;
g.global ??= globalThis;

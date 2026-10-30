// Entry of the hub utility process (see packages/hub/src/worker.ts): the transport only, storage is reached through the parent.
import { fromMessagePort, runWorker } from '@notespark/hub';

runWorker(fromMessagePort((process as unknown as { parentPort: Parameters<typeof fromMessagePort>[0] }).parentPort));

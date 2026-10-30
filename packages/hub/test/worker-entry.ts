// The hub process as a plain Node child (the desktop runs the same function in an Electron utility process).
import { fromProcess } from '../src/port.ts';
import { runWorker } from '../src/worker.ts';

runWorker(fromProcess(process));
process.on('disconnect', () => process.exit(0)); // the parent is gone

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

process.env.NOTESPARK_TEST_SECRETS = '1';
register('./hooks.mjs', pathToFileURL(import.meta.filename));

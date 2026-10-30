import common from './common';
import home from './home';
import editor from './editor';
import note from './note';
import tasks from './tasks';
import scratchpad from './scratchpad';
import ask from './ask';
import settings from './settings';
import profiles from './profiles';
import onboarding from './onboarding';
import importExport from './importExport';
import bin from './bin';
import privacy from './privacy';
import about from './about';
import app from './app';
import core from './core';
import desktop from './desktop';

// The English text, the source of truth: every other language is checked against these keys.
export const en = { ...common, ...home, ...editor, ...note, ...tasks, ...scratchpad, ...ask, ...settings, ...profiles, ...onboarding, ...importExport, ...bin, ...privacy, ...about, ...app, ...core, ...desktop } as const;

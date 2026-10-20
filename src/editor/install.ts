// ---------------------------------------------------------------------------
// Installing as an app (where the browser offers it), and opening files with it.

import { $ } from './dom';
import { openFile } from './files';
import { hint } from './hints';

// installing as an app (where the browser offers it): its own window, and storage the browser keeps
let installPrompt: (Event & { prompt(): Promise<unknown> }) | null = null;

// a .creature file opened from the desktop with the installed app
interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}

export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as typeof installPrompt;
    $('#install-app').hidden = false;
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    $('#install-app').hidden = true;
  });
  $('#install-app').onclick = async () => {
    await installPrompt?.prompt();
    installPrompt = null;
    $('#install-app').hidden = true;
  };
  (window as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue?.setConsumer(async (p) => {
    for (const handle of p.files) {
      const file = await handle.getFile();
      try {
        openFile(await file.text(), file.name);
      } catch (err) {
        hint(`${file.name}: ${(err as Error).message}`, 3500, true);
      }
    }
  });
}

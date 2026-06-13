import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ---- Native folder picker --------------------------------------------------
// The browser sandbox can't return an absolute filesystem path, so we open a
// native dialog server-side and hand the path back to the client. macOS first
// (the dev environment), then Linux/Windows for completeness. The dialog is
// user-driven; if no GUI is available the call returns a clear error so the
// UI can fall back to manual path entry.

type PickResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }
  | { ok: false; error: string };

async function pickMac(): Promise<PickResult> {
  // `choose folder` is the macOS native open dialog. Returns POSIX path on
  // confirm. Throws "User canceled. (-128)" when the user hits Cancel.
  const script =
    'set theFolder to choose folder with prompt "Pick a repo folder"\n' +
    'POSIX path of theFolder';
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 0, // user-driven, no timeout
    });
    const p = stdout.trim();
    return p ? { ok: true, path: p } : { ok: false, canceled: true };
  } catch (e: unknown) {
    const msg = (e as { stderr?: string; message?: string }).stderr ?? '';
    if (/-128|canceled/i.test(msg)) return { ok: false, canceled: true };
    return { ok: false, error: msg || 'osascript failed' };
  }
}

async function pickLinux(): Promise<PickResult> {
  // Try zenity first (GNOME), then kdialog (KDE). The chosen tool exits 1
  // when the user cancels — that's the only signal we need.
  const tools: Array<{ bin: string; args: string[] }> = [
    { bin: 'zenity', args: ['--file-selection', '--directory', '--title=Pick a repo folder'] },
    { bin: 'kdialog', args: ['--getexistingdirectory', '.'] },
  ];
  for (const { bin, args } of tools) {
    try {
      const { stdout } = await execFileAsync(bin, args, { timeout: 0 });
      const p = stdout.trim();
      if (p) return { ok: true, path: p };
      return { ok: false, canceled: true };
    } catch (e: unknown) {
      const err = e as { code?: string | number; status?: number; message?: string };
      if (err.code === 'ENOENT') continue; // not installed, try next
      // Non-zero exit = canceled (zenity/kdialog exit 1 on cancel, 252 on ESC).
      if (err.status === 1 || err.status === 252) return { ok: false, canceled: true };
      // Anything else: try the next tool, fall through to "no GUI" error.
    }
  }
  return { ok: false, error: 'No GTK/KDE dialog tool (zenity or kdialog) found.' };
}

async function pickWindows(): Promise<PickResult> {
  // PowerShell + Windows Forms FolderBrowserDialog. Heavyweight, but it's the
  // only built-in option. Returns the selected path or empty on cancel.
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null;',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
    '$d.Description = "Pick a repo folder";',
    '$d.ShowNewFolderButton = $false;',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
  ].join(' ');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 0 }
    );
    const p = stdout.trim();
    if (p) return { ok: true, path: p };
    return { ok: false, canceled: true };
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message ?? 'PowerShell failed' };
  }
}

export async function POST(): Promise<Response> {
  let result: PickResult;
  if (process.platform === 'darwin') {
    result = await pickMac();
  } else if (process.platform === 'win32') {
    result = await pickWindows();
  } else {
    result = await pickLinux();
  }

  if (result.ok) return Response.json({ success: true, path: result.path });
  if ('canceled' in result) return Response.json({ success: false, canceled: true });
  return Response.json({ success: false, error: result.error }, { status: 500 });
}

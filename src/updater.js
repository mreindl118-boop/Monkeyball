// Startup update check. CI publishes every build as a GitHub Release
// (tag build-<N>) with the APK attached; the app compares its stamped
// build number against the latest release and offers a one-tap update.
// Sideloaded Android can't install silently — the tap downloads the APK
// and Android's installer takes it from there.
import { Browser } from '@capacitor/browser';

const REPO = 'mreindl118-boop/Monkeyball';
export const BUILD = typeof __BUILD_NUM__ !== 'undefined' ? __BUILD_NUM__ : 0;

function isAndroidApp() {
  return !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
}
function isElectron() {
  return navigator.userAgent.includes('Electron');
}

export async function checkForUpdate(onUpdate) {
  if (!BUILD) return;                          // dev/local build — nothing to compare
  if (!isAndroidApp() && !isElectron()) return; // browser players just refresh
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' }
    });
    if (!res.ok) return;
    const rel = await res.json();
    const m = /(\d+)/.exec(rel.tag_name || '');
    const latest = m ? Number(m[1]) : 0;
    if (latest <= BUILD) return;
    const apk = (rel.assets || []).find(a => a.name.endsWith('.apk'));
    const exe = (rel.assets || []).find(a => a.name.endsWith('.exe') && a.name.includes('setup'));
    const url = isAndroidApp()
      ? (apk ? apk.browser_download_url : rel.html_url)
      : (exe ? exe.browser_download_url : rel.html_url);
    onUpdate({
      latest,
      current: BUILD,
      install: () => Browser.open({ url })      // external browser -> download -> installer
    });
  } catch (e) { /* offline is fine — try again next launch */ }
}

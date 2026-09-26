package app.crushlab.game;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import java.io.File;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The APK never uses a service worker. Builds 24-25 registered one, and it kept serving
        // those builds' cached files after upgrades. Deleting the WebView's service-worker storage
        // before the WebView starts removes it for good. Saves live in IndexedDB and localStorage,
        // which are separate folders and untouched.
        File webview = new File(getApplicationInfo().dataDir, "app_webview");
        deleteTree(new File(webview, "Default/Service Worker"));
        deleteTree(new File(webview, "Service Worker"));
        super.onCreate(savedInstanceState);
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteTree(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}

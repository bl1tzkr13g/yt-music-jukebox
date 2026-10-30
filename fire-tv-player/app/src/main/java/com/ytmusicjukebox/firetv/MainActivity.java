package com.ytmusicjukebox.firetv;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.text.InputType;

public class MainActivity extends Activity {
    private WebView webView;
    private String server;
    private void fullscreen() {
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(5894 | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        fullscreen();
        server = getPreferences(MODE_PRIVATE).getString("server", "");
        if (server.isEmpty()) askServer(); else openPlayer();
    }
    private void askServer() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("10.0.0.40:3035");
        input.setText(server.isEmpty() ? "10.0.0.40:3035" : server);
        LinearLayout layout = new LinearLayout(this);
        layout.setPadding(36, 18, 36, 12);
        layout.addView(input);
        new AlertDialog.Builder(this)
            .setTitle("Jukebox server IP")
            .setMessage("Enter your server IP and port")
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton("Connect", (dialog, which) -> {
                String value = input.getText().toString().trim();
                value = value.replaceFirst("^https?://", "").replaceAll("/.*$", "");
                if (!value.matches("^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?::[0-9]{1,5})?$")) {
                    askServer(); return;
                }
                if (!value.contains(":")) value += ":3035";
                server = value;
                getPreferences(MODE_PRIVATE).edit().putString("server", server).apply();
                openPlayer();
            }).show();
    }
    private void openPlayer() {
        webView = new WebView(this);
        webView.setBackgroundColor(0xff000000);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setLoadWithOverviewMode(false);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                return !url.startsWith("http://" + server + "/");
            }
            @Override public void onReceivedError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }
        });
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        setContentView(webView);
        webView.loadUrl("http://" + server + "/player?display=tv");
    }
    private void showError() {
        runOnUiThread(() -> {
            new AlertDialog.Builder(this).setTitle("Cannot connect")
                .setMessage("Check the Fire TV network and jukebox server: " + server)
                .setPositiveButton("Retry", (d, w) -> webView.loadUrl("http://" + server + "/player"))
                .setNegativeButton("Change IP", (d, w) -> askServer())
                .show();
        });
    }
    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) { askServer(); return true; }
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            if (webView != null) webView.evaluateJavascript("window.fireTvStartPlayback && window.fireTvStartPlayback()", null);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) { return true; }
        return super.onKeyDown(keyCode, event);
    }
    @Override protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}

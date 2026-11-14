package com.sascrispy.portal;

import java.util.ArrayList;
import java.util.List;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static java.lang.ref.WeakReference<MainActivity> activeActivityRef = null;

    public static void triggerWebAlarmStop() {
        MainActivity act = activeActivityRef != null ? activeActivityRef.get() : null;
        if (act != null && act.webView != null) {
            act.runOnUiThread(() -> {
                act.webView.evaluateJavascript("if (typeof window.__stopRiderAlarmFromNative === 'function') window.__stopRiderAlarmFromNative(); if (typeof window.__stopKitchenAlarmFromNative === 'function') window.__stopKitchenAlarmFromNative();", null);
            });
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeActivityRef = new java.lang.ref.WeakReference<>(this);
        setContentView(R.layout.activity_main);

        // Keep screen on for Kitchen Admin and Rider Navigation
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Turn screen on and show over lock screen on new order alarm
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }

        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        webView = findViewById(R.id.webView);

        setupWebView();
        requestAppPermissions();

        // Kitchen tablet and Rider app run background OrderMonitorService
        if (shouldRunOrderMonitorService()) {
            startOrderMonitorService();
            requestBatteryOptimizationExemption();
        }

        String targetUrl = getString(R.string.portal_url);
        if (savedInstanceState == null) {
            webView.loadUrl(targetUrl);
        } else {
            webView.restoreState(savedInstanceState);
        }

        swipeRefresh.setOnRefreshListener(() -> webView.reload());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setGeolocationEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false); // Auto-play kitchen siren
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Set realistic Chrome mobile user agent
        String customUA = settings.getUserAgentString() + " SaveraParadiseNativeApp/1.0";
        settings.setUserAgentString(customUA);

        // Register Native Android Notification and Vibration Bridge
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String urlStr = uri.toString();

                // Open external links (Google Maps, WhatsApp, Phone calls, APK downloads) in native apps / browser
                String lowerPath = uri.getPath() != null ? uri.getPath().toLowerCase() : "";
                if (urlStr.startsWith("tel:") || urlStr.startsWith("mailto:") ||
                    urlStr.startsWith("sms:") || urlStr.contains("wa.me") ||
                    urlStr.contains("maps.google.com") || urlStr.contains("google.com/maps") ||
                    lowerPath.endsWith(".apk")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                        return true;
                    } catch (Exception e) {
                        return false;
                    }
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            if (url == null) return;
            String trimmed = url.trim();
            if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) return;
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(trimmed));
                startActivity(intent);
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                } else {
                    progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                // Auto-grant geolocation permissions to our verified restaurant portal
                callback.invoke(origin, true, false);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
    }

    private void requestAppPermissions() {
        boolean isRider = getPackageName().contains("rider");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            List<String> perms = new ArrayList<>();
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
            if (isRider) {
                perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
                perms.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            }
            String[] permissions = perms.toArray(new String[0]);
            boolean needsRequest = false;
            for (String perm : permissions) {
                if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                    needsRequest = true;
                    break;
                }
            }
            if (needsRequest) {
                ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST_CODE);
            }
        } else if (isRider) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                }, PERMISSION_REQUEST_CODE);
            }
        }
    }

    private boolean shouldRunOrderMonitorService() {
        String pkg = getPackageName().toLowerCase();
        return pkg.contains("kitchen") || pkg.contains("rider");
    }

    private void startOrderMonitorService() {
        try {
            Intent serviceIntent = new Intent(this, OrderMonitorService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    @SuppressLint("BatteryLife")
                    Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE && shouldRunOrderMonitorService()) {
            startOrderMonitorService();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && OrderMonitorService.ACTION_STOP_ALARM.equals(intent.getAction())) {
            OrderMonitorService.stopNativeAlarm();
            triggerWebAlarmStop();
            intent.setAction(null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        activeActivityRef = new java.lang.ref.WeakReference<>(this);
        OrderMonitorService.setAppInForeground(true);
        if (getIntent() != null && OrderMonitorService.ACTION_STOP_ALARM.equals(getIntent().getAction())) {
            OrderMonitorService.stopNativeAlarm();
            triggerWebAlarmStop();
            getIntent().setAction(null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        OrderMonitorService.setAppInForeground(false);
    }

    @Override
    protected void onDestroy() {
        if (activeActivityRef != null && activeActivityRef.get() == this) {
            activeActivityRef = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }
}

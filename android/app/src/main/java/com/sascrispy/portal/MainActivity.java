package com.sascrispy.portal;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
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

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Keep screen on for Kitchen Admin and Rider Navigation
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        webView = findViewById(R.id.webView);

        setupWebView();
        requestAppPermissions();
        startOrderMonitorService();
        requestBatteryOptimizationExemption();

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
        String customUA = settings.getUserAgentString() + " SASCrispyNativeApp/1.0";
        settings.setUserAgentString(customUA);

        // Register Native Android Notification and Vibration Bridge
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String urlStr = uri.toString();

                // Open external links (Google Maps, WhatsApp, Phone calls) in native apps
                if (urlStr.startsWith("tel:") || urlStr.startsWith("mailto:") ||
                    urlStr.startsWith("sms:") || urlStr.contains("wa.me") ||
                    urlStr.contains("maps.google.com") || urlStr.contains("google.com/maps")) {
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            String[] permissions = {
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            };
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
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                }, PERMISSION_REQUEST_CODE);
            }
        }
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
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    @SuppressLint("BatteryLife")
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            startOrderMonitorService();
        }
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

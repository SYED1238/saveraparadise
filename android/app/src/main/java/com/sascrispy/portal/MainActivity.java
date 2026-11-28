package com.sascrispy.portal;

import java.util.ArrayList;
import java.util.List;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.gms.common.api.ResolvableApiException;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.LocationSettingsResponse;
import com.google.android.gms.location.Priority;
import com.google.android.gms.location.SettingsClient;
import com.google.android.gms.tasks.Task;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int GPS_ENABLE_REQUEST_CODE = 1003;
    private static final long PLAY_UPDATE_RECHECK_MS = 15 * 60 * 1000L;
    private AppUpdateManager appUpdateManager;
    private boolean playUpdatePromptShownThisSession = false;
    private long lastPlayUpdateCheckMs = 0L;

    private final ActivityResultLauncher<IntentSenderRequest> playUpdateLauncher =
        registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                if (result.getResultCode() != RESULT_OK) {
                    android.util.Log.w("MainActivity", "Play in-app update ended with resultCode=" + result.getResultCode());
                }
            }
        );
    private static java.lang.ref.WeakReference<MainActivity> activeActivityRef = null;
    private volatile String lastKnownUrl = "";

    public static void triggerWebAlarmStop() {
        MainActivity act = activeActivityRef != null ? activeActivityRef.get() : null;
        if (act != null && act.webView != null) {
            final String ackJson = OrderMonitorService.getAcknowledgedAlarmIdsJson();
            act.runOnUiThread(() -> {
                act.webView.evaluateJavascript(
                    "if (typeof window.__syncNativeAcknowledgedAlarms === 'function') window.__syncNativeAcknowledgedAlarms(" + ackJson + "); " +
                    "if (typeof window.__stopRiderAlarmFromNative === 'function') window.__stopRiderAlarmFromNative(" + ackJson + "); " +
                    "if (typeof window.__stopKitchenAlarmFromNative === 'function') window.__stopKitchenAlarmFromNative(" + ackJson + ");",
                    null
                );
            });
        }
    }

    public String getCurrentUrl() {
        if (lastKnownUrl != null && !lastKnownUrl.isEmpty()) {
            return lastKnownUrl;
        }
        return null;
    }

    public static boolean isTrustedPortalHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase().trim();
        return h.equals("saveraparadise.foodbliz.in") ||
               h.endsWith(".saveraparadise.foodbliz.in") ||
               h.equals("saveraparadise.pages.dev") ||
               h.endsWith(".saveraparadise.pages.dev") ||
               h.equals("foodbliz.in") ||
               h.endsWith(".foodbliz.in") ||
               h.equals("localhost") ||
               h.equals("127.0.0.1") ||
               h.equals("10.0.2.2");
    }

    public static boolean isTrustedHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase().trim();
        if (isTrustedPortalHost(h)) return true;
        // Trusted payment gateway hosts for customer checkout redirects
        return h.equals("cashfree.com") ||
               h.endsWith(".cashfree.com");
    }

    public static void syncNativeAcknowledgedAlarmsToWebView() {
        MainActivity act = activeActivityRef != null ? activeActivityRef.get() : null;
        if (act != null && act.webView != null) {
            final String ackJson = OrderMonitorService.getAcknowledgedAlarmIdsJson();
            act.runOnUiThread(() -> {
                act.webView.evaluateJavascript(
                    "if (typeof window.__syncNativeAcknowledgedAlarms === 'function') window.__syncNativeAcknowledgedAlarms(" + ackJson + ");",
                    null
                );
            });
        }
    }

    public static void triggerNativeGpsEnablePrompt() {
        MainActivity act = activeActivityRef != null ? activeActivityRef.get() : null;
        if (act != null) {
            act.runOnUiThread(act::promptToEnableDeviceGps);
        }
    }

    public static void updateRiderScreenWakeFlag(boolean onDuty) {
        MainActivity act = activeActivityRef != null ? activeActivityRef.get() : null;
        if (act != null && act.getPackageName().toLowerCase().contains("rider")) {
            act.runOnUiThread(() -> {
                try {
                    if (onDuty) {
                        act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                } catch (Exception ignored) {}
            });
        }
    }

    public void reloadPortalWebView() {
        if (webView != null) {
            webView.reload();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeActivityRef = new java.lang.ref.WeakReference<>(this);
        setContentView(R.layout.activity_main);

        // Keep screen on for Kitchen Admin and active Rider Navigation (allow Rider phone screen sleep on Break)
        boolean isRiderPkg = getPackageName().toLowerCase().contains("rider");
        if (!isRiderPkg || OrderMonitorService.isRiderOnDuty(this)) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        // Turn screen on and show over lock screen ONLY for dedicated Kitchen Admin tablet.
        // For Rider smartphones, do NOT permanently show over lock screen to prevent double phone-unlock.
        boolean isKitchenTablet = getPackageName().toLowerCase().contains("kitchen");
        if (isKitchenTablet) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
            } else {
                getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                );
            }
        }

        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        webView = findViewById(R.id.webView);

        setupWebView();
        requestAppPermissions();
        OrderMonitorService.registerAppContext(this);
        checkForPlayStoreUpdates(true);

        boolean isRiderPackage = getPackageName().toLowerCase().contains("rider");
        boolean isKitchenPlayPackage = getPackageName().toLowerCase().contains("foodbliz.kitchen");

        // Kitchen tablet and Rider app run background OrderMonitorService
        if (shouldRunOrderMonitorService()) {
            startOrderMonitorService();
            if (!isRiderPackage && !isKitchenPlayPackage) {
                requestBatteryOptimizationExemption();
            }
        }

        String targetUrl = getString(R.string.portal_url);
        if (isRiderPackage) {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("savera_kitchen_prefs", MODE_PRIVATE);
                String savedBase = prefs != null ? prefs.getString("saved_restaurant_base_url", null) : null;
                if (savedBase != null && savedBase.startsWith("https://")) {
                    targetUrl = savedBase.replaceAll("/+$", "") + "/delivery";
                }
            } catch (Exception ignored) {}
        } else if (isKitchenPlayPackage) {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("savera_kitchen_prefs", MODE_PRIVATE);
                String savedBase = prefs != null ? prefs.getString("saved_restaurant_base_url", null) : null;
                if (savedBase != null && savedBase.startsWith("https://")) {
                    targetUrl = savedBase.replaceAll("/+$", "") + "/admin";
                }
            } catch (Exception ignored) {}
        }
        lastKnownUrl = targetUrl;
        if (savedInstanceState == null) {
            webView.loadUrl(targetUrl);
        } else {
            webView.restoreState(savedInstanceState);
        }

        swipeRefresh.setOnRefreshListener(() -> {
            if (webView != null) {
                webView.evaluateJavascript("try { localStorage.setItem('quickbite_pending_gps_resync', Date.now().toString()); } catch(e){}", null);
                webView.reload();
            }
        });
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
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (url != null && !url.isEmpty()) {
                    lastKnownUrl = url;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String urlStr = uri.toString();
                String host = uri.getHost();

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

                // Allow in-WebView navigation only for trusted restaurant portals and verified payment gateways
                if (host != null && isTrustedHost(host)) {
                    return false;
                }

                // Disallow arbitrary third-party web navigation inside WebView — open in external browser
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    startActivity(intent);
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && !url.isEmpty()) {
                    lastKnownUrl = url;
                }
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                syncNativeAcknowledgedAlarmsToWebView();
                if (OrderMonitorService.consumePendingWebAlarmStopSync()) {
                    triggerWebAlarmStop();
                }
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                if (url != null && !url.isEmpty()) {
                    lastKnownUrl = url;
                }
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
                // Auto-grant geolocation permissions ONLY to our verified restaurant portal
                try {
                    Uri uri = Uri.parse(origin);
                    String host = uri.getHost();
                    if (host != null && isTrustedPortalHost(host)) {
                        callback.invoke(origin, true, false);
                        return;
                    }
                } catch (Exception ignored) {}
                callback.invoke(origin, false, false);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                try {
                    Uri origin = request.getOrigin();
                    String host = origin != null ? origin.getHost() : null;
                    if (host != null && isTrustedPortalHost(host)) {
                        runOnUiThread(() -> request.grant(request.getResources()));
                        return;
                    }
                } catch (Exception ignored) {}
                runOnUiThread(() -> request.deny());
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
        boolean isTargetApp = pkg.contains("kitchen") || pkg.contains("rider");
        if (!isTargetApp) {
            return false;
        }
        if (pkg.contains("rider") && !OrderMonitorService.isRiderOnDuty(this)) {
            OrderMonitorService.cancelKeepAliveWatchdogs(this);
            return false;
        }
        if (pkg.startsWith("com.foodbliz.")) {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("savera_kitchen_prefs", MODE_PRIVATE);
                String savedBase = prefs != null ? prefs.getString("saved_restaurant_base_url", null) : null;
                return savedBase != null && !savedBase.trim().isEmpty() && savedBase.startsWith("https://");
            } catch (Exception e) {
                return false;
            }
        }
        return true;
    }

    private void startOrderMonitorService() {
        if (!shouldRunOrderMonitorService()) return;
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

    public boolean isDeviceLocationEnabled() {
        try {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return lm.isLocationEnabled();
            }
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                   lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return false;
        }
    }

    public void promptToEnableDeviceGps() {
        boolean isRider = getPackageName().toLowerCase().contains("rider");
        if (!isRider) return;

        // 1. Ensure OS runtime location permission is granted first
        boolean hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!hasFine && !hasCoarse) {
            ActivityCompat.requestPermissions(this, new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }, PERMISSION_REQUEST_CODE);
            return;
        }

        // 2. Request Google Play Services native one-tap "Turn on device location" system dialog
        try {
            LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMinUpdateIntervalMillis(2000)
                .build();
            LocationSettingsRequest.Builder builder = new LocationSettingsRequest.Builder()
                .addLocationRequest(locationRequest)
                .setAlwaysShow(true);

            SettingsClient client = LocationServices.getSettingsClient(this);
            Task<LocationSettingsResponse> task = client.checkLocationSettings(builder.build());

            task.addOnSuccessListener(this, response -> notifyWebViewGpsEnabled());
            task.addOnFailureListener(this, e -> {
                if (e instanceof ResolvableApiException) {
                    try {
                        ResolvableApiException resolvable = (ResolvableApiException) e;
                        resolvable.startResolutionForResult(MainActivity.this, GPS_ENABLE_REQUEST_CODE);
                        return;
                    } catch (IntentSender.SendIntentException ignored) {}
                }
                openSystemLocationSettingsFallback();
            });
        } catch (Exception e) {
            openSystemLocationSettingsFallback();
        }
    }

    private void openSystemLocationSettingsFallback() {
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            startActivityForResult(intent, GPS_ENABLE_REQUEST_CODE);
        } catch (Exception ignored) {}
    }

    private void notifyWebViewGpsEnabled() {
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(
                "if (typeof window.__onNativeGpsEnabled === 'function') window.__onNativeGpsEnabled();",
                null
            ));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == GPS_ENABLE_REQUEST_CODE) {
            if (resultCode == RESULT_OK || isDeviceLocationEnabled()) {
                notifyWebViewGpsEnabled();
            }
        }
    }

    private boolean isPlayStoreDistributedApp() {
        String pkg = getPackageName();
        return pkg != null && pkg.toLowerCase(java.util.Locale.US).contains("foodbliz");
    }

    private void checkForPlayStoreUpdates(boolean forceFreshCheck) {
        if (!isPlayStoreDistributedApp() || isFinishing() || isDestroyed()) {
            return;
        }
        final long now = System.currentTimeMillis();
        try {
            if (appUpdateManager == null) {
                appUpdateManager = AppUpdateManagerFactory.create(this);
            }
            appUpdateManager.getAppUpdateInfo()
                .addOnSuccessListener(this, appUpdateInfo -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    final int availability = appUpdateInfo.updateAvailability();
                    final boolean immediateAllowed = appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE);
                    if (!immediateAllowed) {
                        return;
                    }
                    if (availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                        try {
                            appUpdateManager.startUpdateFlowForResult(
                                appUpdateInfo,
                                playUpdateLauncher,
                                AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build()
                            );
                        } catch (Exception e) {
                            android.util.Log.w("MainActivity", "Failed to resume Play update flow", e);
                        }
                        return;
                    }
                    boolean shouldCheckNewUpdate = forceFreshCheck
                        || (!playUpdatePromptShownThisSession && (now - lastPlayUpdateCheckMs >= PLAY_UPDATE_RECHECK_MS));
                    if (availability == UpdateAvailability.UPDATE_AVAILABLE && shouldCheckNewUpdate) {
                        lastPlayUpdateCheckMs = now;
                        playUpdatePromptShownThisSession = true;
                        try {
                            appUpdateManager.startUpdateFlowForResult(
                                appUpdateInfo,
                                playUpdateLauncher,
                                AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build()
                            );
                        } catch (Exception e) {
                            android.util.Log.w("MainActivity", "Failed to start Play update flow", e);
                        }
                    }
                })
                .addOnFailureListener(e -> {
                    // Expected on sideloaded builds or when Play Store service is unreachable
                });
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (shouldRunOrderMonitorService()) {
                startOrderMonitorService();
            }
            if (getPackageName().toLowerCase().contains("rider") && OrderMonitorService.isRiderOnDuty(this)) {
                if (!isDeviceLocationEnabled()) {
                    promptToEnableDeviceGps();
                } else {
                    notifyWebViewGpsEnabled();
                }
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && OrderMonitorService.ACTION_STOP_ALARM.equals(intent.getAction())) {
            String orderId = intent.getStringExtra("order_id");
            if (orderId != null && !orderId.isEmpty()) {
                OrderMonitorService.markOrderAlarmAcknowledged(orderId);
            }
            OrderMonitorService.acknowledgeAllActiveAlarms();
            OrderMonitorService.consumePendingWebAlarmStopSync();
            OrderMonitorService.stopNativeAlarm();
            triggerWebAlarmStop();
            intent.setAction(null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        activeActivityRef = new java.lang.ref.WeakReference<>(this);
        OrderMonitorService.registerAppContext(this);
        OrderMonitorService.setAppInForeground(true);
        if (shouldRunOrderMonitorService() && !OrderMonitorService.isServiceRunning()) {
            startOrderMonitorService();
        }
        checkForPlayStoreUpdates(false);
        if (getIntent() != null && OrderMonitorService.ACTION_STOP_ALARM.equals(getIntent().getAction())) {
            String orderId = getIntent().getStringExtra("order_id");
            if (orderId != null && !orderId.isEmpty()) {
                OrderMonitorService.markOrderAlarmAcknowledged(orderId);
            }
            OrderMonitorService.acknowledgeAllActiveAlarms();
            OrderMonitorService.consumePendingWebAlarmStopSync();
            OrderMonitorService.stopNativeAlarm();
            triggerWebAlarmStop();
            getIntent().setAction(null);
        } else {
            syncNativeAcknowledgedAlarmsToWebView();
            if (OrderMonitorService.consumePendingWebAlarmStopSync()) {
                triggerWebAlarmStop();
            }
        }
        if (getPackageName().toLowerCase().contains("rider")) {
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "if (typeof window.__checkRiderAppUpdate === 'function') window.__checkRiderAppUpdate();",
                    null
                ));
            }
            if (!OrderMonitorService.isRiderOnDuty(this)) {
                updateRiderScreenWakeFlag(false);
                OrderMonitorService.cancelKeepAliveWatchdogs(this);
                OrderMonitorService.stopNativeAlarm(false);
            } else if (isDeviceLocationEnabled()) {
                notifyWebViewGpsEnabled();
            }
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

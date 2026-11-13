package com.sascrispy.portal;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * High-reliability native background Foreground Service.
 * Continuously polls Supabase REST API every 4 seconds independently of WebView.
 * Triggers instant heads-up popup notifications with sound & vibration even when:
 * 1. App is minimized / backgrounded
 * 2. Screen is locked
 * 3. App is swiped away / closed from recent tasks
 */
public class OrderMonitorService extends Service {

    private static final String TAG = "OrderMonitorService";
    public static final String CHANNEL_ID_SERVICE = "sas_service_channel";
    public static final String CHANNEL_ID_ALERTS = "sas_orders_channel_v3";
    public static final String ACTION_STOP_ALARM = "com.sascrispy.portal.ACTION_STOP_ALARM";
    private static final int SERVICE_NOTIFICATION_ID = 1001;
    private static final long ALARM_AUTO_STOP_MS = 3 * 60 * 1000L;

    private static final Object alarmLock = new Object();
    private static MediaPlayer alarmPlayer = null;
    private static Ringtone activeRingtone = null;
    private static Vibrator activeVibrator = null;
    private static Handler alarmTimeoutHandler = null;
    private static Runnable alarmTimeoutRunnable = null;
    private static volatile int lastAlertNotifId = -1;

    // Audio Focus & Alarm Volume Management (Ducks/pauses background media e.g. YouTube)
    private static AudioManager audioManager = null;
    private static AudioFocusRequest audioFocusRequest = null;
    private static int originalAlarmVolume = -1;

    // Procedural AudioTrack Siren Synthesizer (Zero-dependency fallback if device ringtones fail)
    private static volatile boolean isSirenRunning = false;
    private static Thread sirenThread = null;
    private static AudioTrack sirenAudioTrack = null;

    private static final String CLOUDFLARE_ENDPOINT = 
        "https://saveraparadise.foodbliz.in/api/order-action?action=kitchen_poll";

    private static final Set<String> knownOrderIds = Collections.synchronizedSet(new HashSet<>());
    private static final Set<String> notifiedReadyIds = Collections.synchronizedSet(new HashSet<>());
    private static volatile OrderMonitorService activeInstance = null;
    private static volatile boolean isAppInForeground = false;

    public static void setAppInForeground(boolean inForeground) {
        isAppInForeground = inForeground;
    }

    public static void startNativeAlarm() {
        OrderMonitorService instance = activeInstance;
        if (instance != null) {
            instance.startNativeAlarmLoop();
        }
    }

    private volatile boolean isRunning = false;
    private Thread pollingThread;
    private boolean isInitialCheck = true;
    private boolean isRiderApp = false;
    private boolean isOwnerApp = false;

    public static void markOrderNotified(String orderId) {
        if (orderId == null || orderId.trim().isEmpty()) {
            return;
        }
        String rawTag = orderId.trim();
        knownOrderIds.add(rawTag);
        notifiedReadyIds.add(rawTag);

        // Strip known web notification prefixes to match raw Supabase order ID
        String normalized = rawTag;
        String[] prefixes = new String[] {
            "admin-order-", "admin-dispatched-", "admin-delivered-", "admin-undelivered-", "admin-overdue-",
            "rider-ready-", "customer-accepted-", "customer-cooking-", "customer-dispatched-",
            "customer-delivered-", "customer-cancelled-", "customer-undelivered-", "order-"
        };
        for (String p : prefixes) {
            if (normalized.startsWith(p)) {
                normalized = normalized.substring(p.length());
                break;
            }
        }
        normalized = normalized.trim();
        if (!normalized.isEmpty()) {
            String bareId = normalized.startsWith("#") ? normalized.substring(1) : normalized;
            String hashId = "#" + bareId;

            knownOrderIds.add(normalized);
            knownOrderIds.add(bareId);
            knownOrderIds.add(hashId);

            notifiedReadyIds.add(normalized);
            notifiedReadyIds.add(bareId);
            notifiedReadyIds.add(hashId);
        }

        if (activeInstance != null) {
            activeInstance.saveKnownOrdersToStorage();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        isRiderApp = getPackageName().toLowerCase().contains("rider");
        isOwnerApp = getPackageName().toLowerCase().contains("owner");

        createNotificationChannels();
        loadKnownOrdersFromStorage();

        startForegroundNotification();
        startPolling();
        scheduleKeepAliveWatchdog();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            // 1. Silent Low-Priority Channel for Foreground Service Status
            NotificationChannel serviceChannel = new NotificationChannel(
                CHANNEL_ID_SERVICE,
                isRiderApp ? "Savera Paradise Rider Monitor" : "Savera Paradise Kitchen Monitor",
                NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription(isRiderApp
                ? "Receives parcel ready-for-pickup alerts during active operating hours"
                : "Receives kitchen order alerts during active operating hours");
            serviceChannel.setShowBadge(false);
            manager.createNotificationChannel(serviceChannel);

            // 2. High-Priority Channel for Heads-Up Order Popup Banner & Continuous Loud Siren
            NotificationChannel alertChannel = new NotificationChannel(
                CHANNEL_ID_ALERTS,
                "Savera Paradise Orders & Critical Alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Loud incoming order sirens and dispatch alerts");
            alertChannel.enableLights(true);
            alertChannel.enableVibration(true);
            alertChannel.setVibrationPattern(new long[]{0, 500, 250, 500, 250, 700});
            alertChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            alertChannel.setShowBadge(true);
            alertChannel.setBypassDnd(true);

            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (soundUri == null) {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            }
            if (soundUri == null) {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build();
            alertChannel.setSound(soundUri, audioAttributes);
            manager.createNotificationChannel(alertChannel);

            // Clean up legacy channel v2 so system doesn't retain old notification-level config
            try {
                manager.deleteNotificationChannel("sas_orders_channel_v2");
            } catch (Exception ignored) {}
        }
    }

    private volatile String lastNotificationMode = "";

    private String getCurrentMonitorMode() {
        if (isNightQuietHoursIST()) return "quiet";
        if (isAppInForeground) return "foreground";
        return "background";
    }

    private Notification buildServiceNotification(String mode) {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openAppIntent, pendingFlags);

        String portalLabel;
        if (isRiderApp) {
            portalLabel = "Savera Rider Dispatch";
        } else if (isOwnerApp) {
            portalLabel = "Savera Owner Monitor";
        } else {
            portalLabel = "Savera Kitchen Monitor";
        }

        String title;
        String subtitle;
        if ("quiet".equals(mode)) {
            title = "🌙 " + portalLabel + " Sleeping";
            subtitle = "Night quiet hours (1 AM – 9 AM IST)";
        } else if ("foreground".equals(mode)) {
            title = "⚡ " + portalLabel + " Live";
            subtitle = "Screen active • Instant order alerts";
        } else {
            title = "🟢 " + portalLabel + " Active";
            subtitle = "Listening for new customer orders";
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID_SERVICE)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .build();
    }

    private void updateForegroundNotificationIfNeeded(String mode) {
        if (mode == null || mode.equals(lastNotificationMode)) return;
        lastNotificationMode = mode;
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(SERVICE_NOTIFICATION_ID, buildServiceNotification(mode));
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to update notification mode: " + e.getMessage());
        }
    }

    private void startForegroundNotification() {
        String initialMode = getCurrentMonitorMode();
        lastNotificationMode = initialMode;
        Notification notification = buildServiceNotification(initialMode);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // API 34
            startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { // API 29
            startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(SERVICE_NOTIFICATION_ID, notification);
        }
    }

    private void loadKnownOrdersFromStorage() {
        try {
            SharedPreferences prefs = getSharedPreferences("sas_monitor_prefs", Context.MODE_PRIVATE);
            Set<String> savedKnown = prefs.getStringSet("known_ids", null);
            if (savedKnown != null && !savedKnown.isEmpty()) {
                knownOrderIds.addAll(savedKnown);
                isInitialCheck = false;
            }
            Set<String> savedReady = prefs.getStringSet("ready_ids", null);
            if (savedReady != null && !savedReady.isEmpty()) {
                notifiedReadyIds.addAll(savedReady);
            }
        } catch (Exception e) {
            Log.w(TAG, "Error loading known orders: " + e.getMessage());
        }
    }

    private void saveKnownOrdersToStorage() {
        try {
            SharedPreferences prefs = getSharedPreferences("sas_monitor_prefs", Context.MODE_PRIVATE);
            // Limit stored set size to latest 50
            Set<String> boundedKnown = new HashSet<>();
            synchronized (knownOrderIds) {
                for (String id : knownOrderIds) {
                    boundedKnown.add(id);
                    if (boundedKnown.size() >= 50) break;
                }
            }
            Set<String> boundedReady = new HashSet<>();
            synchronized (notifiedReadyIds) {
                for (String id : notifiedReadyIds) {
                    boundedReady.add(id);
                    if (boundedReady.size() >= 50) break;
                }
            }
            prefs.edit()
                .putStringSet("known_ids", boundedKnown)
                .putStringSet("ready_ids", boundedReady)
                .apply();
        } catch (Exception e) {
            Log.w(TAG, "Error saving known orders: " + e.getMessage());
        }
    }

    private boolean isNightQuietHoursIST() {
        try {
            java.util.Calendar cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Kolkata"));
            int hour = cal.get(java.util.Calendar.HOUR_OF_DAY);
            // Night quiet hours: 1:00 AM to 9:00 AM IST
            return hour >= 1 && hour < 9;
        } catch (Exception e) {
            return false;
        }
    }

    private void startPolling() {
        if (isRunning) return;
        isRunning = true;

        pollingThread = new Thread(() -> {
            // Immediately seed known order IDs on service start (even if foreground)
            // so isInitialCheck is cleared before any real customer order arrives,
            // except during night quiet hours (1:00 AM - 9:00 AM IST).
            if (isInitialCheck && !isNightQuietHoursIST()) {
                try {
                    Log.i(TAG, "Running initial seed poll on service start to clear isInitialCheck");
                    pollKitchenOrders();
                } catch (Exception e) {
                    Log.w(TAG, "Initial seed poll exception: " + e.getMessage());
                }
            }

            while (isRunning) {
                // 1. If currently in night quiet hours (1:00 AM to 9:00 AM IST), sleep 60 seconds
                if (isNightQuietHoursIST()) {
                    updateForegroundNotificationIfNeeded("quiet");
                    try {
                        Thread.sleep(60000);
                    } catch (InterruptedException e) {
                        break;
                    }
                    continue;
                }

                // 2. If app is active on screen in foreground, WebView WebSocket handles orders in <200ms
                if (isAppInForeground) {
                    updateForegroundNotificationIfNeeded("foreground");
                    try {
                        Thread.sleep(15000); // Sleep gently while user is active on screen
                    } catch (InterruptedException e) {
                        break;
                    }
                    continue;
                }

                // 3. Otherwise (minimized/backgrounded during operating hours), poll Cloudflare
                updateForegroundNotificationIfNeeded("background");
                try {
                    pollKitchenOrders();
                } catch (Exception e) {
                    Log.w(TAG, "Polling exception: " + e.getMessage());
                }

                try {
                    Thread.sleep(20000); // Poll every 20 seconds when minimized (aligned with 25s edge cache)
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "Savera-OrderMonitorThread");
        pollingThread.start();
    }

    private void pollKitchenOrders() {
        HttpURLConnection conn = null;
        try {
            // Priority 1: Cloudflare Edge-Cached endpoint (0 Supabase Log Ingestion)
            URL url = new URL(CLOUDFLARE_ENDPOINT);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);

            int responseCode = conn.getResponseCode();
            if (responseCode == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();

                String respStr = sb.toString().trim();
                JSONArray orders = null;
                if (respStr.startsWith("[")) {
                    orders = new JSONArray(respStr);
                } else if (respStr.startsWith("{")) {
                    JSONObject obj = new JSONObject(respStr);
                    orders = obj.optJSONArray("orders");
                }
                if (orders != null) {
                    processIncomingOrders(orders);
                    return;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Cloudflare kitchen poll error: " + e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
                conn = null;
            }
        }
    }

    private void processIncomingOrders(JSONArray orders) {
        try {
            long now = System.currentTimeMillis();

            // First run on cold start: seed known IDs without alerting to prevent spamming old orders
            // EXCEPT orders created within the last 90 seconds — those are fresh and MUST notify
            if (isInitialCheck) {
                for (int i = 0; i < orders.length(); i++) {
                    JSONObject order = orders.getJSONObject(i);
                    String id = order.optString("id");
                    if (id.isEmpty()) continue;

                    long createdAt = order.optLong("created_at", 0);
                    String status = order.optString("status");
                    String assignedRider = order.optString("assigned_rider_pin", "").trim();
                    boolean isClaimed = !assignedRider.isEmpty();
                    boolean isFreshKitchenOrder = (createdAt > 0 && (now - createdAt <= 90 * 1000L));
                    boolean isActiveReadyOrder = (createdAt > 0 && (now - createdAt <= 2 * 60 * 60 * 1000L))
                        && "ready_for_pickup".equalsIgnoreCase(status) && !isClaimed;

                    if (!isRiderApp && isFreshKitchenOrder && !knownOrderIds.contains(id)) {
                        knownOrderIds.add(id);
                        if (!"cancelled".equalsIgnoreCase(status) && !"delivered".equalsIgnoreCase(status)) {
                            String custName = order.optString("customer_name", "Customer");
                            String total = order.optString("total", "");
                            String pickupCode = order.optString("pickup_code", "");
                            fireHeadsUpNotification(
                                "\uD83C\uDF57 NEW ORDER " + id + "!",
                                custName + " • " + total + (pickupCode.isEmpty() ? "" : " • Code: " + pickupCode),
                                id
                            );
                        }
                    } else if (isRiderApp && isActiveReadyOrder && !notifiedReadyIds.contains(id)) {
                        knownOrderIds.add(id);
                        notifiedReadyIds.add(id);
                        fireHeadsUpNotification(
                            "\uD83D\uDEF5 NEW PARCEL READY FOR PICKUP",
                            "A food parcel is packed on the kitchen counter. Collect the bag to check the 4-digit code written inside.",
                            id
                        );
                    } else {
                        knownOrderIds.add(id);
                        if ("ready_for_pickup".equalsIgnoreCase(status)) {
                            notifiedReadyIds.add(id);
                        }
                    }
                }
                isInitialCheck = false;
                saveKnownOrdersToStorage();
                return;
            }

            for (int i = 0; i < orders.length(); i++) {
                JSONObject order = orders.getJSONObject(i);
                String id = order.optString("id");
                String status = order.optString("status");
                String custName = order.optString("customer_name", "Customer");
                String total = order.optString("total", "");
                String pickupCode = order.optString("pickup_code", "");
                String address = order.optString("delivery_address", "");
                long createdAt = order.optLong("created_at", 0);

                // Ignore orders older than 12 hours
                if (createdAt > 0 && (now - createdAt > 12 * 60 * 60 * 1000L)) {
                    knownOrderIds.add(id);
                    continue;
                }

                if (!isRiderApp) {
                    // Kitchen Admin App: Alert for newly created orders
                    if (!knownOrderIds.contains(id)) {
                        knownOrderIds.add(id);
                        if (!"cancelled".equalsIgnoreCase(status) && !"delivered".equalsIgnoreCase(status)) {
                            fireHeadsUpNotification(
                                "🍗 NEW ORDER " + id + "!",
                                custName + " • " + total + (pickupCode.isEmpty() ? "" : " • Code: " + pickupCode),
                                id
                            );
                            saveKnownOrdersToStorage();
                        }
                    }
                } else {
                    // Rider App: Alert when food is marked ready for pickup (blinded notification - bag number remains inside physical bag)
                    boolean isClaimed = !order.optString("assigned_rider_pin", "").trim().isEmpty();
                    boolean isReady = "ready_for_pickup".equalsIgnoreCase(status) && !isClaimed;
                    if (isReady && !notifiedReadyIds.contains(id)) {
                        notifiedReadyIds.add(id);
                        knownOrderIds.add(id);
                        fireHeadsUpNotification(
                            "🛵 NEW PARCEL READY FOR PICKUP",
                            "A food parcel is packed on the kitchen counter. Collect the bag to check the 4-digit code written inside.",
                            id
                        );
                        saveKnownOrdersToStorage();
                    } else if (!knownOrderIds.contains(id)) {
                        knownOrderIds.add(id);
                        saveKnownOrdersToStorage();
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing incoming orders", e);
        }
    }

    private void acquireAudioFocus() {
        try {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AudioAttributes playbackAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                    audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                        .setAudioAttributes(playbackAttributes)
                        .setAcceptsDelayedFocusGain(false)
                        .setOnAudioFocusChangeListener(focusChange -> Log.d(TAG, "Audio focus changed: " + focusChange))
                        .build();
                    audioManager.requestAudioFocus(audioFocusRequest);
                } else {
                    audioManager.requestAudioFocus(
                        null,
                        AudioManager.STREAM_ALARM,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
                    );
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire audio focus: " + e.getMessage());
        }
    }

    private static void releaseAudioFocus() {
        try {
            if (audioManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                    audioManager.abandonAudioFocusRequest(audioFocusRequest);
                    audioFocusRequest = null;
                } else {
                    audioManager.abandonAudioFocus(null);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to release audio focus: " + e.getMessage());
        }
    }

    private void elevateAlarmVolumeIfNeeded() {
        try {
            if (audioManager == null) {
                audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            }
            if (audioManager != null) {
                int maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                int currentVol = audioManager.getStreamVolume(AudioManager.STREAM_ALARM);
                int targetVol = Math.max((int) (maxVol * 0.8), 1);
                if (currentVol < targetVol) {
                    originalAlarmVolume = currentVol;
                    audioManager.setStreamVolume(AudioManager.STREAM_ALARM, targetVol, 0);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not adjust alarm stream volume: " + e.getMessage());
        }
    }

    private static void restoreAlarmVolume() {
        try {
            if (originalAlarmVolume != -1 && audioManager != null) {
                audioManager.setStreamVolume(AudioManager.STREAM_ALARM, originalAlarmVolume, 0);
            }
        } catch (Exception ignored) {}
        originalAlarmVolume = -1;
    }

    private List<Uri> getAlarmCandidateUris() {
        List<Uri> uris = new ArrayList<>();
        Context ctx = getApplicationContext();

        // 1. User's actual default Alarm sound
        try {
            Uri u = RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_ALARM);
            if (u != null) uris.add(u);
        } catch (Exception ignored) {}

        // 2. Default Alarm URI constant
        try {
            Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (u != null && !uris.contains(u)) uris.add(u);
        } catch (Exception ignored) {}

        // 3. System Alarm Alert Settings URI
        try {
            Uri u = Settings.System.DEFAULT_ALARM_ALERT_URI;
            if (u != null && !uris.contains(u)) uris.add(u);
        } catch (Exception ignored) {}

        // 4. User's actual default Ringtone sound
        try {
            Uri u = RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_RINGTONE);
            if (u != null && !uris.contains(u)) uris.add(u);
        } catch (Exception ignored) {}

        // 5. Default Ringtone URI constant
        try {
            Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (u != null && !uris.contains(u)) uris.add(u);
        } catch (Exception ignored) {}

        // 6. User's actual default Notification sound
        try {
            Uri u = RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_NOTIFICATION);
            if (u != null && !uris.contains(u)) uris.add(u);
        } catch (Exception ignored) {}

        // 7. Default Notification URI constant
        try {
            Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (u != null && !uris.contains(u)) uris.add(u);
        } catch (Exception ignored) {}

        return uris;
    }

    private static void startProceduralSiren() {
        synchronized (alarmLock) {
            if (isSirenRunning) return;
            isSirenRunning = true;

            sirenThread = new Thread(() -> {
                int sampleRate = 44100;
                int bufferSize = AudioTrack.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                );
                if (bufferSize <= 0) bufferSize = sampleRate;

                AudioTrack track = null;
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        track = new AudioTrack(
                            new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ALARM)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build(),
                            new AudioFormat.Builder()
                                .setSampleRate(sampleRate)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .build(),
                            bufferSize,
                            AudioTrack.MODE_STREAM,
                            0
                        );
                    } else {
                        track = new AudioTrack(
                            AudioManager.STREAM_ALARM,
                            sampleRate,
                            AudioFormat.CHANNEL_OUT_MONO,
                            AudioFormat.ENCODING_PCM_16BIT,
                            bufferSize,
                            AudioTrack.MODE_STREAM
                        );
                    }

                    sirenAudioTrack = track;
                    track.play();

                    double[] freqs = new double[]{ 880.0, 1174.66, 1760.0 };
                    int noteSamples = (int) (sampleRate * 0.25); // 250ms per tone
                    short[] buffer = new short[noteSamples];

                    while (isSirenRunning) {
                        for (double freq : freqs) {
                            if (!isSirenRunning) break;
                            for (int i = 0; i < noteSamples; i++) {
                                double angle = 2.0 * Math.PI * i * freq / sampleRate;
                                buffer[i] = (short) (Math.sin(angle) * 32767 * 0.85);
                            }
                            track.write(buffer, 0, noteSamples);
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Procedural siren execution error: " + e.getMessage());
                } finally {
                    if (track != null) {
                        try {
                            track.stop();
                        } catch (Exception ignored) {}
                        try {
                            track.release();
                        } catch (Exception ignored) {}
                    }
                    sirenAudioTrack = null;
                }
            }, "Savera-ProceduralSirenThread");

            sirenThread.start();
        }
    }

    private static void stopProceduralSiren() {
        isSirenRunning = false;
        if (sirenThread != null) {
            try {
                sirenThread.interrupt();
            } catch (Exception ignored) {}
            sirenThread = null;
        }
        if (sirenAudioTrack != null) {
            try {
                sirenAudioTrack.stop();
            } catch (Exception ignored) {}
            try {
                sirenAudioTrack.release();
            } catch (Exception ignored) {}
            sirenAudioTrack = null;
        }
    }

    public static void stopNativeAlarm() {
        synchronized (alarmLock) {
            if (alarmTimeoutHandler != null && alarmTimeoutRunnable != null) {
                try {
                    alarmTimeoutHandler.removeCallbacks(alarmTimeoutRunnable);
                } catch (Exception ignored) {}
                alarmTimeoutRunnable = null;
            }
            if (alarmPlayer != null) {
                try {
                    if (alarmPlayer.isPlaying()) {
                        alarmPlayer.stop();
                    }
                } catch (Exception ignored) {}
                try {
                    alarmPlayer.release();
                } catch (Exception ignored) {}
                alarmPlayer = null;
            }
            if (activeRingtone != null) {
                try {
                    if (activeRingtone.isPlaying()) {
                        activeRingtone.stop();
                    }
                } catch (Exception ignored) {}
                activeRingtone = null;
            }
            stopProceduralSiren();
            if (activeVibrator != null) {
                try {
                    activeVibrator.cancel();
                } catch (Exception ignored) {}
                activeVibrator = null;
            }
            restoreAlarmVolume();
            releaseAudioFocus();
        }

        OrderMonitorService instance = activeInstance;
        if (instance != null) {
            try {
                Vibrator v = (Vibrator) instance.getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null) {
                    v.cancel();
                }
            } catch (Exception ignored) {}

            int notifToCancel = lastAlertNotifId;
            if (notifToCancel != -1) {
                lastAlertNotifId = -1;
                try {
                    NotificationManager manager = (NotificationManager) instance.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (manager != null) {
                        manager.cancel(notifToCancel);
                    }
                } catch (Exception ignored) {}
            }
        }
    }

    private void startNativeAlarmLoop() {
        if (isOwnerApp) {
            return;
        }
        synchronized (alarmLock) {
            if (alarmTimeoutHandler != null && alarmTimeoutRunnable != null) {
                try {
                    alarmTimeoutHandler.removeCallbacks(alarmTimeoutRunnable);
                } catch (Exception ignored) {}
                alarmTimeoutRunnable = null;
            }
            if (alarmPlayer != null) {
                try {
                    if (alarmPlayer.isPlaying()) alarmPlayer.stop();
                } catch (Exception ignored) {}
                try {
                    alarmPlayer.release();
                } catch (Exception ignored) {}
                alarmPlayer = null;
            }
            if (activeRingtone != null) {
                try {
                    if (activeRingtone.isPlaying()) activeRingtone.stop();
                } catch (Exception ignored) {}
                activeRingtone = null;
            }
            stopProceduralSiren();

            // 1. Duck/pause YouTube or background music and claim exclusive audio
            acquireAudioFocus();

            // 2. Safeguard stream volume so alarm is loudly audible
            elevateAlarmVolumeIfNeeded();

            // 3. Multi-Tier Audio Playback
            boolean audioStarted = false;
            List<Uri> candidates = getAlarmCandidateUris();

            // Tier 1: MediaPlayer with DataSource resolution
            for (Uri uri : candidates) {
                if (uri == null) continue;
                MediaPlayer mp = new MediaPlayer();
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        mp.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build());
                    } else {
                        mp.setAudioStreamType(AudioManager.STREAM_ALARM);
                    }

                    try {
                        AssetFileDescriptor afd = getContentResolver().openAssetFileDescriptor(uri, "r");
                        if (afd != null) {
                            mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                            afd.close();
                        } else {
                            mp.setDataSource(getApplicationContext(), uri);
                        }
                    } catch (Exception e) {
                        mp.setDataSource(getApplicationContext(), uri);
                    }

                    mp.setLooping(true);
                    mp.prepare();
                    mp.start();
                    alarmPlayer = mp;
                    audioStarted = true;
                    Log.i(TAG, "Native alarm MediaPlayer successfully started with URI: " + uri);
                    break;
                } catch (Exception e) {
                    try {
                        mp.release();
                    } catch (Exception ignored) {}
                    Log.w(TAG, "MediaPlayer candidate failed for " + uri + ": " + e.getMessage());
                }
            }

            // Tier 2: System Ringtone object (Bypasses Samsung One UI file sandbox restrictions)
            if (!audioStarted) {
                for (Uri uri : candidates) {
                    if (uri == null) continue;
                    try {
                        Ringtone ringtone = RingtoneManager.getRingtone(getApplicationContext(), uri);
                        if (ringtone != null) {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                ringtone.setAudioAttributes(new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_ALARM)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build());
                            } else {
                                ringtone.setStreamType(AudioManager.STREAM_ALARM);
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                                ringtone.setLooping(true);
                            }
                            ringtone.play();
                            activeRingtone = ringtone;
                            audioStarted = true;
                            Log.i(TAG, "Native alarm Ringtone successfully started with URI: " + uri);
                            break;
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Ringtone candidate failed for " + uri + ": " + e.getMessage());
                    }
                }
            }

            // Tier 3: Zero-dependency Procedural Kitchen Siren via AudioTrack
            if (!audioStarted) {
                Log.i(TAG, "All system ringtones failed. Starting procedural kitchen siren AudioTrack...");
                startProceduralSiren();
                audioStarted = true;
            }

            // Continuous hardware vibration pattern
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) {
                    activeVibrator = v;
                    long[] pattern = new long[]{0, 500, 250, 500, 250, 700};
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        AudioAttributes vibeAttrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build();
                        v.vibrate(VibrationEffect.createWaveform(pattern, 0), vibeAttrs);
                    } else {
                        v.vibrate(pattern, 0);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Repeating vibrator start failed: " + e.getMessage());
            }

            // Auto-stop safety timeout (3 minutes)
            try {
                if (alarmTimeoutHandler == null) {
                    alarmTimeoutHandler = new Handler(Looper.getMainLooper());
                }
                alarmTimeoutRunnable = OrderMonitorService::stopNativeAlarm;
                alarmTimeoutHandler.postDelayed(alarmTimeoutRunnable, ALARM_AUTO_STOP_MS);
            } catch (Exception e) {
                Log.w(TAG, "Alarm safety timeout scheduling failed: " + e.getMessage());
            }
        }
    }

    private void fireHeadsUpNotification(String title, String message, String orderId) {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra("order_id", orderId);

            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(this, (int) System.currentTimeMillis(), intent, pendingFlags);

            int notifId = orderId != null ? Math.abs(orderId.hashCode()) : (int) System.currentTimeMillis();
            lastAlertNotifId = notifId;

            Intent stopIntent = new Intent(this, OrderMonitorService.class);
            stopIntent.setAction(ACTION_STOP_ALARM);
            stopIntent.putExtra("notif_id", notifId);
            PendingIntent stopPendingIntent = PendingIntent.getService(this, notifId + 1, stopIntent, pendingFlags);

            Uri soundUri = RingtoneManager.getDefaultUri(isOwnerApp ? RingtoneManager.TYPE_NOTIFICATION : RingtoneManager.TYPE_ALARM);
            if (soundUri == null) {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            }
            if (soundUri == null) {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_ALERTS)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_LIGHTS)
                .setSound(soundUri, AudioManager.STREAM_ALARM)
                .setVibrate(new long[]{0, 500, 250, 500, 250, 700})
                .setAutoCancel(true)
                .setFullScreenIntent(pendingIntent, true)
                .setDeleteIntent(stopPendingIntent)
                .setContentIntent(pendingIntent);

            if (!isOwnerApp) {
                builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "🛑 Stop Alarm", stopPendingIntent);
            }

            Notification notification = builder.build();
            notification.flags |= Notification.FLAG_INSISTENT;
            manager.notify(notifId, notification);

            if (!isOwnerApp) {
                startNativeAlarmLoop();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error firing heads-up notification", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP_ALARM.equals(intent.getAction())) {
            int notifId = intent.getIntExtra("notif_id", -1);
            stopNativeAlarm();
            if (notifId != -1) {
                try {
                    NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (manager != null) {
                        manager.cancel(notifId);
                    }
                } catch (Exception ignored) {}
            }
            return START_STICKY;
        }
        startPolling();
        return START_STICKY; // Tell Android to auto-recreate service if killed
    }

    private void scheduleKeepAliveWatchdog() {
        try {
            Intent watchdogIntent = new Intent(getApplicationContext(), OrderMonitorReceiver.class);
            watchdogIntent.setAction(OrderMonitorReceiver.ACTION_RESTART_MONITOR);
            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent watchdogPending = PendingIntent.getBroadcast(
                getApplicationContext(),
                1003,
                watchdogIntent,
                pendingFlags
            );
            AlarmManager am = (AlarmManager) getApplicationContext().getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                am.setInexactRepeating(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + 15 * 60 * 1000L,
                    15 * 60 * 1000L,
                    watchdogPending
                );
            }
        } catch (Exception e) {
            Log.w(TAG, "Watchdog alarm scheduling failed: " + e.getMessage());
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Re-schedule service restart via OrderMonitorReceiver when user swipes away app from recents
        try {
            Intent restartBroadcast = new Intent(getApplicationContext(), OrderMonitorReceiver.class);
            restartBroadcast.setAction(OrderMonitorReceiver.ACTION_RESTART_MONITOR);
            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent restartPending = PendingIntent.getBroadcast(
                getApplicationContext(),
                1002,
                restartBroadcast,
                pendingFlags
            );
            AlarmManager alarmService = (AlarmManager) getApplicationContext().getSystemService(Context.ALARM_SERVICE);
            if (alarmService != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmService.setExactAndAllowWhileIdle(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        SystemClock.elapsedRealtime() + 1500,
                        restartPending
                    );
                } else {
                    alarmService.set(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        SystemClock.elapsedRealtime() + 1500,
                        restartPending
                    );
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error scheduling task restart: " + e.getMessage());
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        stopNativeAlarm();
        if (pollingThread != null) {
            pollingThread.interrupt();
        }
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

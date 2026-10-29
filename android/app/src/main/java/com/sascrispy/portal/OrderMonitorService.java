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
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.HashSet;
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
    public static final String CHANNEL_ID_ALERTS = "sas_orders_channel_v2";
    private static final int SERVICE_NOTIFICATION_ID = 1001;

    private static final String SUPABASE_ENDPOINT = 
        "https://zrgkglwqkdxmwrgepnqh.supabase.co/rest/v1/orders?select=id,status,customer_name,total,pickup_code,delivery_address,created_at&order=created_at.desc&limit=8";
    private static final String SUPABASE_KEY = 
        "sb_publishable_obyAWrTPc2oIxF3V9Bp23Q_cd_WxEZk";

    private static final Set<String> knownOrderIds = Collections.synchronizedSet(new HashSet<>());
    private static final Set<String> notifiedReadyIds = Collections.synchronizedSet(new HashSet<>());
    private static volatile OrderMonitorService activeInstance = null;

    private volatile boolean isRunning = false;
    private Thread pollingThread;
    private boolean isInitialCheck = true;
    private boolean isRiderApp = false;

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

        createNotificationChannels();
        loadKnownOrdersFromStorage();

        startForegroundNotification();
        startPolling();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            // 1. Silent Low-Priority Channel for Foreground Service Status
            NotificationChannel serviceChannel = new NotificationChannel(
                CHANNEL_ID_SERVICE,
                "SAS Background Monitor",
                NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("Keeps order notifications alive 24/7 when app is closed");
            serviceChannel.setShowBadge(false);
            manager.createNotificationChannel(serviceChannel);

            // 2. High-Priority Channel for Heads-Up Order Popup Banner
            NotificationChannel alertChannel = new NotificationChannel(
                CHANNEL_ID_ALERTS,
                "SAS Orders & Critical Alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Loud incoming order sirens and dispatch alerts");
            alertChannel.enableLights(true);
            alertChannel.enableVibration(true);
            alertChannel.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 600});
            alertChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            alertChannel.setShowBadge(true);

            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build();
            alertChannel.setSound(soundUri, audioAttributes);
            manager.createNotificationChannel(alertChannel);
        }
    }

    private void startForegroundNotification() {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openAppIntent, pendingFlags);

        String title = isRiderApp ? "🟢 SAS Rider Dispatch Active" : "🟢 SAS Kitchen Monitor Active";
        String subtitle = "24/7 live order monitoring active in background";

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID_SERVICE)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .build();

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

    private void startPolling() {
        if (isRunning) return;
        isRunning = true;

        pollingThread = new Thread(() -> {
            while (isRunning) {
                try {
                    pollSupabaseOrders();
                } catch (Exception e) {
                    Log.w(TAG, "Polling exception: " + e.getMessage());
                }

                try {
                    Thread.sleep(4000); // Poll every 4 seconds
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "SAS-OrderMonitorThread");
        pollingThread.start();
    }

    private void pollSupabaseOrders() {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_ENDPOINT);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("apikey", SUPABASE_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + SUPABASE_KEY);
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            int responseCode = conn.getResponseCode();
            if (responseCode == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();

                JSONArray orders = new JSONArray(sb.toString());
                processIncomingOrders(orders);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to fetch orders from Supabase: " + e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void processIncomingOrders(JSONArray orders) {
        try {
            long now = System.currentTimeMillis();

            // First run on cold start: seed known IDs without alerting to prevent spamming old orders
            if (isInitialCheck) {
                for (int i = 0; i < orders.length(); i++) {
                    JSONObject order = orders.getJSONObject(i);
                    String id = order.optString("id");
                    if (!id.isEmpty()) {
                        knownOrderIds.add(id);
                        if ("ready_for_pickup".equalsIgnoreCase(order.optString("status"))) {
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
                    // Rider App: Alert when food is marked ready for pickup
                    boolean isReady = "ready_for_pickup".equalsIgnoreCase(status);
                    if (isReady && !notifiedReadyIds.contains(id)) {
                        notifiedReadyIds.add(id);
                        knownOrderIds.add(id);
                        fireHeadsUpNotification(
                            "🛵 ORDER READY FOR PICKUP " + id,
                            "Pickup Code: " + pickupCode + " • " + total + " • " + address,
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

            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_ALERTS)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_MAX) // Required for heads-up popup banner
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setSound(soundUri)
                .setVibrate(new long[]{0, 400, 200, 400, 200, 600})
                .setAutoCancel(true)
                .setFullScreenIntent(pendingIntent, true) // Triggers heads-up popup banner over other apps / lockscreen
                .setContentIntent(pendingIntent);

            int notifId = orderId != null ? Math.abs(orderId.hashCode()) : (int) System.currentTimeMillis();
            manager.notify(notifId, builder.build());

            // Hardware Haptic Vibration
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(new long[]{0, 400, 200, 400, 200, 600}, -1));
                } else {
                    v.vibrate(new long[]{0, 400, 200, 400, 200, 600}, -1);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error firing heads-up notification", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startPolling();
        return START_STICKY; // Tell Android to auto-recreate service if killed
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Re-schedule service restart when user swipes away app from recent apps
        try {
            Intent restartServiceIntent = new Intent(getApplicationContext(), OrderMonitorService.class);
            restartServiceIntent.setPackage(getPackageName());
            int pendingFlags = PendingIntent.FLAG_ONE_SHOT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent restartPendingIntent = PendingIntent.getService(
                getApplicationContext(), 
                1002, 
                restartServiceIntent, 
                pendingFlags
            );
            AlarmManager alarmService = (AlarmManager) getApplicationContext().getSystemService(Context.ALARM_SERVICE);
            if (alarmService != null) {
                alarmService.set(
                    AlarmManager.ELAPSED_REALTIME,
                    SystemClock.elapsedRealtime() + 1500,
                    restartPendingIntent
                );
            }
        } catch (Exception e) {
            Log.w(TAG, "Error scheduling task restart: " + e.getMessage());
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        isRunning = false;
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

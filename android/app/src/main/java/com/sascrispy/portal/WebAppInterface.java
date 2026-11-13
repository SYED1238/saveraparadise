package com.sascrispy.portal;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class WebAppInterface {

    private final Context context;
    public static final String CHANNEL_ID_ORDERS = "sas_orders_channel_v3";
    public static final String CHANNEL_NAME_ORDERS = "Savera Paradise Orders & Critical Alerts";

    public WebAppInterface(Context context) {
        this.context = context;
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID_ORDERS,
                CHANNEL_NAME_ORDERS,
                NotificationManager.IMPORTANCE_HIGH // HIGH importance creates heads-up banner popup (like WhatsApp)
            );
            channel.setDescription("Critical kitchen order alarms and delivery partner dispatch alerts");
            channel.enableLights(true);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 250, 500, 250, 700});
            channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            channel.setShowBadge(true);
            channel.setBypassDnd(true);

            Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (defaultSoundUri == null) {
                defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build();
            channel.setSound(defaultSoundUri, audioAttributes);

            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                try {
                    manager.deleteNotificationChannel("sas_orders_channel_v2");
                } catch (Exception ignored) {}
            }
        }
    }

    @JavascriptInterface
    public void showNotification(String title, String message, String tag, String soundType) {
        try {
            // Mark order notified in background service to prevent double alerting
            OrderMonitorService.markOrderNotified(tag);

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            // Intent to bring MainActivity to the front on tap
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            
            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(context, (int) System.currentTimeMillis(), intent, pendingFlags);

            int notifId = tag != null ? Math.abs(tag.hashCode()) : (int) System.currentTimeMillis();

            // Urgent alarm alerts for Kitchen (new order) and Rider (parcel ready on counter)
            boolean isAlarmAlert = "kitchen_alarm".equals(soundType) ||
                                   "new_order".equals(soundType) ||
                                   "rider_new_task".equals(soundType) ||
                                   "rider_alarm".equals(soundType) ||
                                   (tag != null && (tag.startsWith("admin-order-") || 
                                                    tag.startsWith("rider-ready-") || 
                                                    tag.startsWith("rider-task-") ||
                                                    tag.startsWith("rider-")));

            int priority;
            String category;
            Uri soundUri;

            if (isAlarmAlert) {
                priority = NotificationCompat.PRIORITY_MAX;
                category = NotificationCompat.CATEGORY_ALARM;
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (soundUri == null) {
                    soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                }
                if (soundUri == null) {
                    soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                }
            } else {
                priority = NotificationCompat.PRIORITY_HIGH;
                category = NotificationCompat.CATEGORY_EVENT;
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID_ORDERS)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(priority)
                .setCategory(category)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

            if (isAlarmAlert) {
                builder.setSound(soundUri, AudioManager.STREAM_ALARM)
                    .setVibrate(new long[]{0, 500, 250, 500, 250, 700})
                    .setFullScreenIntent(pendingIntent, true);

                Intent stopIntent = new Intent(context, OrderMonitorService.class);
                stopIntent.setAction(OrderMonitorService.ACTION_STOP_ALARM);
                stopIntent.putExtra("notif_id", notifId);
                PendingIntent stopPendingIntent = PendingIntent.getService(context, notifId + 1, stopIntent, pendingFlags);
                builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "🛑 Stop Alarm", stopPendingIntent);
                builder.setDeleteIntent(stopPendingIntent);
            } else {
                builder.setSound(soundUri)
                    .setVibrate(new long[]{0, 350, 200, 350, 200, 500});
            }

            Notification notif = builder.build();
            if (isAlarmAlert) {
                notif.flags |= Notification.FLAG_INSISTENT;
            }
            manager.notify(notifId, notif);

            if (isAlarmAlert) {
                OrderMonitorService.setLastAlertNotifId(notifId);
                // Start continuous looping MediaPlayer + repeating Vibrator waveform & acquire audio focus
                OrderMonitorService.startNativeAlarm();
            } else {
                // One-shot haptic vibration for non-alarm notifications (e.g. cash settled)
                Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) {
                    v.vibrate(new long[]{0, 350, 200, 350}, -1);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @JavascriptInterface
    public void startAlarm() {
        try {
            OrderMonitorService.startNativeAlarm();
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && context instanceof Activity) {
            Activity activity = (Activity) context;
            if (ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(activity, new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1002);
            }
        }
    }

    @JavascriptInterface
    public void triggerVibration() {
        try {
            if (OrderMonitorService.isAlarmActive()) {
                return; // Guard active continuous alarm waveform against premature cancellation
            }
            Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                v.vibrate(new long[]{0, 300, 150, 300}, -1);
            }
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void stopAlarm() {
        try {
            OrderMonitorService.stopNativeAlarm();
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void setDutyStatus(boolean onDuty) {
        try {
            OrderMonitorService.setRiderDutyStatus(context, onDuty);
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    @JavascriptInterface
    public void openExternalUrl(String url) {
        if (url == null) return;
        String trimmed = url.trim();
        if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(trimmed));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}

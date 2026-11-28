package com.sascrispy.portal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

/**
 * Resilient BroadcastReceiver ensuring OrderMonitorService restarts reliably
 * across device reboots, app updates, and swipe-to-kill tasks.
 */
public class OrderMonitorReceiver extends BroadcastReceiver {

    private static final String TAG = "OrderMonitorReceiver";
    public static final String ACTION_RESTART_MONITOR = "com.sascrispy.portal.ACTION_RESTART_MONITOR";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : "";
        Log.i(TAG, "OrderMonitorReceiver received broadcast action: " + action);

        if (context == null) return;

        String pkg = context.getPackageName().toLowerCase();
        boolean shouldRun = pkg.contains("kitchen") || pkg.contains("rider");
        if (!shouldRun) return;

        if (pkg.contains("rider") && !OrderMonitorService.isRiderOnDuty(context)) {
            Log.i(TAG, "Skipping OrderMonitorService start from receiver: Rider is Off Duty / On Break");
            OrderMonitorService.cancelKeepAliveWatchdogs(context);
            return;
        }

        if (pkg.startsWith("com.foodbliz.")) {
            try {
                android.content.SharedPreferences prefs = context.getSharedPreferences("savera_kitchen_prefs", Context.MODE_PRIVATE);
                String savedBase = prefs != null ? prefs.getString("saved_restaurant_base_url", null) : null;
                if (savedBase == null || savedBase.trim().isEmpty() || !savedBase.startsWith("https://")) {
                    Log.i(TAG, "Skipping OrderMonitorService start from receiver: com.foodbliz app has no valid saved_restaurant_base_url");
                    return;
                }
            } catch (Exception e) {
                return;
            }
        }

        try {
            Intent serviceIntent = new Intent(context, OrderMonitorService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            Log.i(TAG, "Successfully triggered OrderMonitorService start from receiver");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start OrderMonitorService from receiver: " + e.getMessage(), e);
        }
    }
}

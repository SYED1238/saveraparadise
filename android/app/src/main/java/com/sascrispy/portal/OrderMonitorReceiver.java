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

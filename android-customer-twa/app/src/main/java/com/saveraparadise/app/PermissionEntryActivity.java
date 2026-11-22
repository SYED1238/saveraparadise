package com.saveraparadise.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

/**
 * PermissionEntryActivity
 * Plain Activity entry-point that prompts for native Android 13+ (API 33+) POST_NOTIFICATIONS
 * runtime permission on first launch, then seamlessly forwards to LauncherActivity with zero flicker.
 */
public class PermissionEntryActivity extends Activity {

    private static final String PREFS_NAME = "savera_twa_prefs";
    private static final String KEY_ASKED_NOTIF_PERM = "asked_notif_perm";
    private static final int PERMISSION_REQUEST_CODE = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 33) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean alreadyAsked = prefs.getBoolean(KEY_ASKED_NOTIF_PERM, false);
            boolean notGranted = checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED;

            if (notGranted && !alreadyAsked) {
                prefs.edit().putBoolean(KEY_ASKED_NOTIF_PERM, true).apply();
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST_CODE);
                return;
            }
        }

        launchTwa();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        launchTwa();
    }

    private void launchTwa() {
        Intent intent = new Intent(this, com.google.androidbrowserhelper.trusted.LauncherActivity.class);
        Intent incomingIntent = getIntent();
        if (incomingIntent != null) {
            if (incomingIntent.getData() != null) {
                intent.setData(incomingIntent.getData());
            }
            if (incomingIntent.getAction() != null) {
                intent.setAction(incomingIntent.getAction());
            }
            if (incomingIntent.getExtras() != null) {
                intent.putExtras(incomingIntent.getExtras());
            }
        }
        startActivity(intent);
        finish();
        overridePendingTransition(0, 0);
    }
}

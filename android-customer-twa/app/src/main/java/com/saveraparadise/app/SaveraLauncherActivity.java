package com.saveraparadise.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

public class SaveraLauncherActivity extends LauncherActivity {

    private static final String PREFS_NAME = "savera_twa_prefs";
    private static final String KEY_ASKED_NOTIF_PERM = "asked_notif_perm";
    private static final int PERMISSION_REQUEST_CODE = 1001;

    private boolean mWaitingForNotifPermission = false;

    private boolean needsNotifPrompt() {
        if (Build.VERSION.SDK_INT >= 33) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean asked = prefs.getBoolean(KEY_ASKED_NOTIF_PERM, false);
            boolean notGranted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED;
            return !asked && notGranted;
        }
        return false;
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        if (needsNotifPrompt()) {
            mWaitingForNotifPermission = true;
            return false;
        }
        return true;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (mWaitingForNotifPermission && !isFinishing()) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putBoolean(KEY_ASKED_NOTIF_PERM, true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE && mWaitingForNotifPermission) {
            mWaitingForNotifPermission = false;
            if (!isFinishing()) {
                launchTwa();
            }
        }
    }
}

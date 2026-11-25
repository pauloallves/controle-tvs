package com.controletv.googletv;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtvRemotePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

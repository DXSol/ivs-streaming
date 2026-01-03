package com.dxsoltech.sampradayaevents;

import android.content.Context;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;
import com.google.android.gms.cast.framework.media.CastMediaOptions;
import com.google.android.gms.cast.framework.media.NotificationOptions;

import java.util.List;

public class CastOptionsProvider implements OptionsProvider {
    
    // Default Cast App ID - you can replace this with your own Cast App ID if you have one
    private static final String DEFAULT_APP_ID = "CC1AD845";
    
    @Override
    public CastOptions getCastOptions(Context context) {
        NotificationOptions notificationOptions = new NotificationOptions.Builder()
                .setTargetActivityClassName(MainActivity.class.getName())
                .build();
        
        CastMediaOptions mediaOptions = new CastMediaOptions.Builder()
                .setNotificationOptions(notificationOptions)
                .setExpandedControllerActivityClassName(MainActivity.class.getName())
                .build();
        
        return new CastOptions.Builder()
                .setReceiverApplicationId(DEFAULT_APP_ID)
                .setCastMediaOptions(mediaOptions)
                .build();
    }
    
    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return null;
    }
}

package com.dxsoltech.sampradayaevents.videoplayer;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class DlnaService {
    private static final String TAG = "DlnaService";
    private static final String SSDP_ADDRESS = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final String SEARCH_TARGET = "urn:schemas-upnp-org:service:AVTransport:1";
    
    private Activity activity;
    private ExecutorService executor;
    private Handler mainHandler;
    private List<DlnaDevice> discoveredDevices = new ArrayList<>();
    private DlnaDeviceListener deviceListener;
    private DlnaDevice selectedDevice;
    private String currentMediaUrl;
    private boolean isDiscovering = false;
    private WifiManager.MulticastLock multicastLock;
    
    public static class DlnaDevice {
        public String name;
        public String manufacturer;
        public String location;
        public String controlUrl;
        public String udn;
        
        @Override
        public String toString() {
            return name;
        }
    }
    
    public interface DlnaDeviceListener {
        void onDeviceFound(DlnaDevice device);
        void onDeviceRemoved(DlnaDevice device);
        void onPlaybackStarted();
        void onPlaybackError(String error);
    }
    
    public DlnaService(Activity activity) {
        this.activity = activity;
        this.executor = Executors.newCachedThreadPool();
        this.mainHandler = new Handler(Looper.getMainLooper());
        
        // Acquire multicast lock for SSDP discovery
        WifiManager wifi = (WifiManager) activity.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            multicastLock = wifi.createMulticastLock("dlna_discovery");
            multicastLock.setReferenceCounted(true);
        }
    }
    
    public void setDeviceListener(DlnaDeviceListener listener) {
        this.deviceListener = listener;
    }
    
    public void startDiscovery() {
        if (isDiscovering) return;
        isDiscovering = true;
        
        if (multicastLock != null && !multicastLock.isHeld()) {
            multicastLock.acquire();
        }
        
        executor.execute(() -> {
            try {
                discoverDevices();
            } catch (Exception e) {
                Log.e(TAG, "Discovery error: " + e.getMessage());
            }
        });
    }
    
    public void stopDiscovery() {
        isDiscovering = false;
        if (multicastLock != null && multicastLock.isHeld()) {
            multicastLock.release();
        }
    }
    
    private void discoverDevices() {
        try {
            // Send SSDP M-SEARCH
            String searchMessage = 
                "M-SEARCH * HTTP/1.1\r\n" +
                "HOST: " + SSDP_ADDRESS + ":" + SSDP_PORT + "\r\n" +
                "MAN: \"ssdp:discover\"\r\n" +
                "MX: 3\r\n" +
                "ST: " + SEARCH_TARGET + "\r\n" +
                "\r\n";
            
            DatagramSocket socket = new DatagramSocket();
            socket.setSoTimeout(5000);
            
            InetAddress group = InetAddress.getByName(SSDP_ADDRESS);
            DatagramPacket packet = new DatagramPacket(
                searchMessage.getBytes(), 
                searchMessage.length(), 
                group, 
                SSDP_PORT
            );
            
            socket.send(packet);
            Log.d(TAG, "Sent SSDP M-SEARCH");
            
            // Listen for responses
            byte[] buffer = new byte[8192];
            long endTime = System.currentTimeMillis() + 5000;
            
            while (System.currentTimeMillis() < endTime && isDiscovering) {
                try {
                    DatagramPacket response = new DatagramPacket(buffer, buffer.length);
                    socket.receive(response);
                    
                    String responseStr = new String(response.getData(), 0, response.getLength());
                    Log.d(TAG, "SSDP Response: " + responseStr);
                    
                    // Parse LOCATION header
                    String location = parseHeader(responseStr, "LOCATION");
                    if (location != null && !location.isEmpty()) {
                        fetchDeviceDescription(location);
                    }
                } catch (Exception e) {
                    // Timeout or error, continue
                }
            }
            
            socket.close();
        } catch (Exception e) {
            Log.e(TAG, "SSDP discovery error: " + e.getMessage());
        }
    }
    
    private String parseHeader(String response, String header) {
        String[] lines = response.split("\r\n");
        for (String line : lines) {
            if (line.toUpperCase().startsWith(header.toUpperCase() + ":")) {
                return line.substring(header.length() + 1).trim();
            }
        }
        return null;
    }
    
    private void fetchDeviceDescription(String location) {
        executor.execute(() -> {
            try {
                URL url = new URL(location);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder xml = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    xml.append(line);
                }
                reader.close();
                
                // Parse device info from XML
                DlnaDevice device = parseDeviceXml(xml.toString(), location);
                if (device != null && !containsDevice(device)) {
                    mainHandler.post(() -> {
                        discoveredDevices.add(device);
                        Log.d(TAG, "DLNA device found: " + device.name);
                        if (deviceListener != null) {
                            deviceListener.onDeviceFound(device);
                        }
                    });
                }
            } catch (Exception e) {
                Log.e(TAG, "Error fetching device description: " + e.getMessage());
            }
        });
    }
    
    private DlnaDevice parseDeviceXml(String xml, String location) {
        try {
            DlnaDevice device = new DlnaDevice();
            device.location = location;
            
            // Simple XML parsing for device info
            device.name = extractXmlValue(xml, "friendlyName");
            device.manufacturer = extractXmlValue(xml, "manufacturer");
            device.udn = extractXmlValue(xml, "UDN");
            
            // Find AVTransport control URL
            String baseUrl = location.substring(0, location.lastIndexOf("/"));
            String controlUrl = extractXmlValue(xml, "controlURL");
            if (controlUrl != null) {
                if (!controlUrl.startsWith("http")) {
                    controlUrl = baseUrl + (controlUrl.startsWith("/") ? "" : "/") + controlUrl;
                }
                device.controlUrl = controlUrl;
            }
            
            if (device.name == null || device.name.isEmpty()) {
                device.name = "Unknown Device";
            }
            
            return device;
        } catch (Exception e) {
            Log.e(TAG, "Error parsing device XML: " + e.getMessage());
            return null;
        }
    }
    
    private String extractXmlValue(String xml, String tag) {
        String startTag = "<" + tag + ">";
        String endTag = "</" + tag + ">";
        int start = xml.indexOf(startTag);
        int end = xml.indexOf(endTag);
        if (start >= 0 && end > start) {
            return xml.substring(start + startTag.length(), end).trim();
        }
        return null;
    }
    
    private boolean containsDevice(DlnaDevice device) {
        for (DlnaDevice d : discoveredDevices) {
            if (d.udn != null && d.udn.equals(device.udn)) {
                return true;
            }
        }
        return false;
    }
    
    public List<DlnaDevice> getDiscoveredDevices() {
        return new ArrayList<>(discoveredDevices);
    }
    
    public void showDevicePicker(String mediaUrl) {
        this.currentMediaUrl = mediaUrl;
        
        // Refresh discovery
        discoveredDevices.clear();
        startDiscovery();
        
        // Show dialog after a short delay to allow discovery
        mainHandler.postDelayed(() -> {
            DeviceListAdapter adapter = new DeviceListAdapter(activity, discoveredDevices);
            
            AlertDialog.Builder builder = new AlertDialog.Builder(activity);
            builder.setTitle("Select DLNA Device");
            
            if (discoveredDevices.isEmpty()) {
                builder.setMessage("Searching for DLNA devices...\n\nMake sure your TV or media player is on the same WiFi network.");
                builder.setNegativeButton("Cancel", null);
                builder.setPositiveButton("Refresh", (dialog, which) -> {
                    mainHandler.postDelayed(() -> showDevicePicker(mediaUrl), 1000);
                });
            } else {
                builder.setAdapter(adapter, (dialog, which) -> {
                    DlnaDevice device = discoveredDevices.get(which);
                    playOnDevice(device, mediaUrl);
                });
                builder.setNegativeButton("Cancel", null);
            }
            
            builder.show();
        }, 3000); // Wait 3 seconds for discovery
    }
    
    public void playOnDevice(DlnaDevice device, String mediaUrl) {
        this.selectedDevice = device;
        this.currentMediaUrl = mediaUrl;
        
        if (device.controlUrl == null) {
            if (deviceListener != null) {
                deviceListener.onPlaybackError("Device control URL not found");
            }
            return;
        }
        
        executor.execute(() -> {
            try {
                // Send SetAVTransportURI SOAP action
                String soapAction = "\"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI\"";
                String soapBody = 
                    "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                    "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
                    "<s:Body>" +
                    "<u:SetAVTransportURI xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">" +
                    "<InstanceID>0</InstanceID>" +
                    "<CurrentURI>" + escapeXml(mediaUrl) + "</CurrentURI>" +
                    "<CurrentURIMetaData></CurrentURIMetaData>" +
                    "</u:SetAVTransportURI>" +
                    "</s:Body>" +
                    "</s:Envelope>";
                
                boolean setUriSuccess = sendSoapRequest(device.controlUrl, soapAction, soapBody);
                
                if (setUriSuccess) {
                    // Send Play SOAP action
                    String playSoapAction = "\"urn:schemas-upnp-org:service:AVTransport:1#Play\"";
                    String playSoapBody = 
                        "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                        "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
                        "<s:Body>" +
                        "<u:Play xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">" +
                        "<InstanceID>0</InstanceID>" +
                        "<Speed>1</Speed>" +
                        "</u:Play>" +
                        "</s:Body>" +
                        "</s:Envelope>";
                    
                    boolean playSuccess = sendSoapRequest(device.controlUrl, playSoapAction, playSoapBody);
                    
                    if (playSuccess) {
                        mainHandler.post(() -> {
                            if (deviceListener != null) {
                                deviceListener.onPlaybackStarted();
                            }
                        });
                    } else {
                        mainHandler.post(() -> {
                            if (deviceListener != null) {
                                deviceListener.onPlaybackError("Failed to start playback");
                            }
                        });
                    }
                } else {
                    mainHandler.post(() -> {
                        if (deviceListener != null) {
                            deviceListener.onPlaybackError("Failed to set media URI");
                        }
                    });
                }
            } catch (Exception e) {
                Log.e(TAG, "Playback error: " + e.getMessage());
                mainHandler.post(() -> {
                    if (deviceListener != null) {
                        deviceListener.onPlaybackError(e.getMessage());
                    }
                });
            }
        });
    }
    
    private boolean sendSoapRequest(String url, String soapAction, String soapBody) {
        try {
            URL controlUrl = new URL(url);
            HttpURLConnection conn = (HttpURLConnection) controlUrl.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "text/xml; charset=utf-8");
            conn.setRequestProperty("SOAPAction", soapAction);
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            
            PrintWriter writer = new PrintWriter(new OutputStreamWriter(conn.getOutputStream()));
            writer.print(soapBody);
            writer.flush();
            writer.close();
            
            int responseCode = conn.getResponseCode();
            Log.d(TAG, "SOAP response code: " + responseCode);
            
            return responseCode == 200;
        } catch (Exception e) {
            Log.e(TAG, "SOAP request error: " + e.getMessage());
            return false;
        }
    }
    
    private String escapeXml(String text) {
        return text.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace("\"", "&quot;")
                   .replace("'", "&apos;");
    }
    
    public void stopPlayback() {
        if (selectedDevice == null || selectedDevice.controlUrl == null) return;
        
        executor.execute(() -> {
            try {
                String soapAction = "\"urn:schemas-upnp-org:service:AVTransport:1#Stop\"";
                String soapBody = 
                    "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                    "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
                    "<s:Body>" +
                    "<u:Stop xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">" +
                    "<InstanceID>0</InstanceID>" +
                    "</u:Stop>" +
                    "</s:Body>" +
                    "</s:Envelope>";
                
                sendSoapRequest(selectedDevice.controlUrl, soapAction, soapBody);
            } catch (Exception e) {
                Log.e(TAG, "Stop playback error: " + e.getMessage());
            }
        });
    }
    
    public boolean isDeviceSelected() {
        return selectedDevice != null;
    }
    
    public String getSelectedDeviceName() {
        return selectedDevice != null ? selectedDevice.name : null;
    }
    
    public void destroy() {
        stopDiscovery();
        stopPlayback();
        if (executor != null) {
            executor.shutdown();
        }
    }
    
    // Custom adapter for device list
    private class DeviceListAdapter extends ArrayAdapter<DlnaDevice> {
        public DeviceListAdapter(Context context, List<DlnaDevice> devices) {
            super(context, android.R.layout.simple_list_item_2, android.R.id.text1, devices);
        }
        
        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View view = super.getView(position, convertView, parent);
            
            DlnaDevice device = getItem(position);
            if (device != null) {
                TextView text1 = view.findViewById(android.R.id.text1);
                TextView text2 = view.findViewById(android.R.id.text2);
                
                text1.setText(device.name);
                text2.setText(device.manufacturer != null ? device.manufacturer : "Unknown");
            }
            
            return view;
        }
    }
}

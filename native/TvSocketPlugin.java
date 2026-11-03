package com.controletv.app;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Ponte nativa para falar com a TV.
 *
 * - open/send/close: WebSocket aceitando o certificado autoassinado da TV
 *   (apenas para endereços de rede local; qualquer outro destino é recusado).
 * - discover: varre a sub-rede do Wi-Fi procurando TVs Samsung (porta 8001/8002).
 */
@CapacitorPlugin(name = "TvSocket")
public class TvSocketPlugin extends Plugin {
    private static final String TAG = "TvSocket";

    private final Map<Integer, WebSocket> sockets = new ConcurrentHashMap<>();
    private OkHttpClient client;
    private SSLSocketFactory trustAllFactory;
    private HostnameVerifier trustAllVerifier;

    @Override
    public void load() {
        try {
            final X509TrustManager trustAll = new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) {}

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            };
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[] {trustAll}, new SecureRandom());
            trustAllFactory = ctx.getSocketFactory();
            trustAllVerifier = new HostnameVerifier() {
                @Override
                public boolean verify(String hostname, SSLSession session) {
                    return true;
                }
            };
            client = new OkHttpClient.Builder()
                    .sslSocketFactory(trustAllFactory, trustAll)
                    .hostnameVerifier(trustAllVerifier)
                    .connectTimeout(8, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .build();
        } catch (Exception e) {
            Log.e(TAG, "falha ao preparar o cliente", e);
        }
    }

    // ---------------------------------------------------------------- WebSocket

    private static boolean isPrivateHost(String host) {
        if (host == null) return false;
        if (host.endsWith(".local")) return true;
        String[] p = host.split("\\.");
        if (p.length != 4) return false;
        try {
            int a = Integer.parseInt(p[0]);
            int b = Integer.parseInt(p[1]);
            int c = Integer.parseInt(p[2]);
            int d = Integer.parseInt(p[3]);
            if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) {
                return false;
            }
            if (a == 10) return true;
            if (a == 192 && b == 168) return true;
            if (a == 172 && b >= 16 && b <= 31) return true;
            return a == 169 && b == 254;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private void emit(int id, String type, String data) {
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("type", type);
        if (data != null) o.put("data", data);
        notifyListeners("tvSocket", o);
    }

    @PluginMethod
    public void open(PluginCall call) {
        final int id = call.getInt("id", 0);
        String url = call.getString("url");
        if (client == null || url == null) {
            call.reject("cliente indisponível");
            return;
        }
        String host;
        try {
            host = new URL(url.replaceFirst("^ws", "http")).getHost();
        } catch (Exception e) {
            call.reject("endereço inválido");
            return;
        }
        if (!isPrivateHost(host)) {
            call.reject("somente endereços de rede local são permitidos");
            return;
        }
        Request request = new Request.Builder().url(url).build();
        WebSocket ws = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                emit(id, "open", null);
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                emit(id, "message", text);
            }

            @Override
            public void onClosing(WebSocket webSocket, int code, String reason) {
                webSocket.close(1000, null);
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                sockets.remove(id);
                emit(id, "close", null);
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                sockets.remove(id);
                emit(id, "error", String.valueOf(t.getMessage()));
                emit(id, "close", null);
            }
        });
        sockets.put(id, ws);
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        WebSocket ws = sockets.get(call.getInt("id", 0));
        String data = call.getString("data");
        if (ws == null || data == null) {
            call.reject("socket fechado");
            return;
        }
        ws.send(data);
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        WebSocket ws = sockets.remove(call.getInt("id", 0));
        if (ws != null) {
            ws.close(1000, null);
        }
        call.resolve();
    }

    // ---------------------------------------------------------------- HTTP (API REST da TV)

    /**
     * Chamada HTTP simples para a TV (ex.: POST http://IP:8001/api/v2/applications/ID).
     * Somente endereços de rede local. Sempre resolve com {status, body}; status -1 = erro.
     */
    @PluginMethod
    public void rest(final PluginCall call) {
        final String method = call.getString("method", "GET");
        final String urlStr = call.getString("url");
        if (urlStr == null || !(urlStr.startsWith("http://") || urlStr.startsWith("https://"))) {
            call.reject("endereço inválido");
            return;
        }
        String host;
        try {
            host = new URL(urlStr).getHost();
        } catch (Exception e) {
            call.reject("endereço inválido");
            return;
        }
        if (!isPrivateHost(host)) {
            call.reject("somente endereços de rede local são permitidos");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject result = new JSObject();
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(urlStr).openConnection();
                    if (conn instanceof HttpsURLConnection) {
                        ((HttpsURLConnection) conn).setSSLSocketFactory(trustAllFactory);
                        ((HttpsURLConnection) conn).setHostnameVerifier(trustAllVerifier);
                    }
                    conn.setConnectTimeout(3000);
                    conn.setReadTimeout(5000);
                    conn.setRequestMethod(method);
                    if ("POST".equals(method)) {
                        conn.setDoOutput(true);
                        conn.setFixedLengthStreamingMode(0);
                    }
                    int code = conn.getResponseCode();
                    InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    String body = "";
                    if (in != null) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buf = new byte[2048];
                        int n;
                        while ((n = in.read(buf)) > 0 && out.size() < 8192) {
                            out.write(buf, 0, n);
                        }
                        body = out.toString("UTF-8");
                    }
                    result.put("status", code);
                    result.put("body", body);
                } catch (Exception e) {
                    result.put("status", -1);
                    result.put("body", String.valueOf(e.getMessage()));
                } finally {
                    if (conn != null) conn.disconnect();
                }
                call.resolve(result);
            }
        }).start();
    }

    // ---------------------------------------------------------------- Busca de TV

    private static List<String> candidateHosts() {
        List<String> hosts = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            if (ifaces == null) return hosts;
            for (NetworkInterface ni : Collections.list(ifaces)) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    if (!(addr instanceof Inet4Address) || !addr.isSiteLocalAddress()) continue;
                    byte[] b = addr.getAddress();
                    int self = b[3] & 0xFF;
                    String prefix = (b[0] & 0xFF) + "." + (b[1] & 0xFF) + "." + (b[2] & 0xFF) + ".";
                    for (int i = 1; i <= 254; i++) {
                        if (i == self) continue;
                        String h = prefix + i;
                        if (!hosts.contains(h)) hosts.add(h);
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "falha ao listar interfaces", e);
        }
        return hosts;
    }

    private String fetchInfo(String scheme, String host, int port) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(scheme + "://" + host + ":" + port + "/api/v2/");
            conn = (HttpURLConnection) url.openConnection();
            if (conn instanceof HttpsURLConnection) {
                ((HttpsURLConnection) conn).setSSLSocketFactory(trustAllFactory);
                ((HttpsURLConnection) conn).setHostnameVerifier(trustAllVerifier);
            }
            conn.setConnectTimeout(1500);
            conn.setReadTimeout(2000);
            conn.setRequestMethod("GET");
            if (conn.getResponseCode() != 200) return null;
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < 16384) {
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private boolean portOpen(String host, int port) {
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(host, port), 450);
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            try {
                s.close();
            } catch (Exception ignored) {
            }
        }
    }

    private JSObject probe(String host) {
        String body = null;
        if (portOpen(host, 8001)) {
            body = fetchInfo("http", host, 8001);
        }
        if (body == null && portOpen(host, 8002)) {
            body = fetchInfo("https", host, 8002);
        }
        if (body == null) return null;
        try {
            JSONObject json = new JSONObject(body);
            String type = json.optString("type", "");
            if (!type.toLowerCase().contains("samsung")) return null;
            JSONObject device = json.optJSONObject("device");
            JSObject tv = new JSObject();
            tv.put("ip", host);
            tv.put("name", json.optString("name", "TV Samsung"));
            tv.put("model", device != null ? device.optString("modelName", "") : "");
            return tv;
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void discover(final PluginCall call) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                ExecutorService pool = Executors.newFixedThreadPool(48);
                JSArray found = new JSArray();
                try {
                    List<Future<JSObject>> futures = new ArrayList<>();
                    for (final String host : candidateHosts()) {
                        futures.add(pool.submit(new Callable<JSObject>() {
                            @Override
                            public JSObject call() {
                                return probe(host);
                            }
                        }));
                    }
                    for (Future<JSObject> f : futures) {
                        try {
                            JSObject tv = f.get(20, TimeUnit.SECONDS);
                            if (tv != null) found.put(tv);
                        } catch (Exception ignored) {
                        }
                    }
                } finally {
                    pool.shutdownNow();
                }
                JSObject result = new JSObject();
                result.put("tvs", found);
                call.resolve(result);
            }
        }).start();
    }
}

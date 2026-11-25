package com.controletv.googletv;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Ponte nativa para controlar TVs Google TV / Android TV (protocolo Android TV Remote v2).
 * A lógica do protocolo está em AtvProtocol (sem dependências do Android).
 */
@CapacitorPlugin(name = "AtvRemote")
public class AtvRemotePlugin extends Plugin {
    private static final String TAG = "AtvRemote";

    private AtvProtocol.Identity identity;
    private AtvProtocol.Pairing pairing;
    private AtvProtocol.Remote remote;

    private void emit(String type, String data) {
        JSObject o = new JSObject();
        o.put("type", type);
        o.put("data", data);
        notifyListeners("atv", o);
    }

    private synchronized AtvProtocol.Identity identity() throws Exception {
        if (identity == null) identity = AtvProtocol.loadOrCreateIdentity(getContext().getFilesDir());
        return identity;
    }

    private static boolean isPrivateHost(String host) {
        if (host == null) return false;
        String[] p = host.split("\\.");
        if (p.length != 4) return false;
        try {
            int a = Integer.parseInt(p[0]);
            int b = Integer.parseInt(p[1]);
            int c = Integer.parseInt(p[2]);
            int d = Integer.parseInt(p[3]);
            if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) return false;
            if (a == 10) return true;
            if (a == 192 && b == 168) return true;
            return a == 172 && b >= 16 && b <= 31;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- pareamento

    @PluginMethod
    public void pairStart(final PluginCall call) {
        final String ip = call.getString("ip");
        if (!isPrivateHost(ip)) {
            call.reject("Endereço inválido (use o IP da TV na sua rede, como 192.168.0.20)");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (pairing != null) pairing.close();
                    pairing = new AtvProtocol.Pairing(identity());
                    pairing.start(ip, "Controle TV");
                    emit("log", "pareamento iniciado: veja o código na tela da TV");
                    call.resolve();
                } catch (Exception e) {
                    Log.w(TAG, "pairStart", e);
                    call.reject(describe(e));
                }
            }
        }).start();
    }

    @PluginMethod
    public void pairFinish(final PluginCall call) {
        final String code = call.getString("code");
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (pairing == null) throw new IllegalStateException("Inicie o pareamento primeiro");
                    pairing.finish(code);
                    pairing = null;
                    emit("log", "pareamento concluído");
                    call.resolve();
                } catch (Exception e) {
                    Log.w(TAG, "pairFinish", e);
                    call.reject(describe(e));
                }
            }
        }).start();
    }

    @PluginMethod
    public void forget(PluginCall call) {
        try {
            if (remote != null) remote.close();
            if (pairing != null) pairing.close();
        } catch (Exception ignored) {
        }
        remote = null;
        pairing = null;
        identity = null;
        AtvProtocol.deleteIdentity(getContext().getFilesDir());
        call.resolve();
    }

    private static String describe(Exception e) {
        String m = e.getMessage();
        if (e instanceof java.net.SocketTimeoutException || e instanceof java.net.ConnectException) {
            return "Não foi possível falar com a TV. Confira se ela está ligada e na mesma rede Wi-Fi.";
        }
        return (m == null || m.isEmpty()) ? e.getClass().getSimpleName() : m;
    }

    // ---------------------------------------------------------------- controle

    @PluginMethod
    public void connect(final PluginCall call) {
        final String ip = call.getString("ip");
        if (!isPrivateHost(ip)) {
            call.reject("Endereço inválido");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (remote != null) remote.close();
                    remote = new AtvProtocol.Remote(identity(), new AtvProtocol.Events() {
                        @Override
                        public void onLog(String line) {
                            emit("log", line);
                        }

                        @Override
                        public void onState(String state) {
                            emit("state", state);
                        }
                    });
                    remote.connect(ip);
                    call.resolve();
                } catch (Exception e) {
                    Log.w(TAG, "connect", e);
                    call.reject(describe(e));
                }
            }
        }).start();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        if (remote != null) remote.close();
        call.resolve();
    }

    @PluginMethod
    public void key(final PluginCall call) {
        final Integer code = call.getInt("code");
        final int direction = call.getInt("direction", 3);
        if (code == null) {
            call.reject("tecla ausente");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (remote == null) throw new IllegalStateException("TV não conectada");
                    remote.key(code, direction);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(describe(e));
                }
            }
        }).start();
    }

    @PluginMethod
    public void launch(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("link ausente");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (remote == null) throw new IllegalStateException("TV não conectada");
                    remote.launch(url);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(describe(e));
                }
            }
        }).start();
    }

    // ---------------------------------------------------------------- busca na rede

    private static List<String> candidateHosts() {
        List<String> hosts = new ArrayList<String>();
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

    private static boolean portOpen(String host, int port) {
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(host, port), 1500);
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

    /** Descoberta por mDNS (_androidtvremote2._tcp): é como o app oficial acha a TV. */
    private void nsdDiscover(final java.util.Map<String, String> out, long waitMs) {
        final NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        if (nsd == null) return;
        final ExecutorService resolver = Executors.newSingleThreadExecutor();
        final NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String t, int e) { emit("log", "mDNS falhou: " + e); }
            @Override public void onStopDiscoveryFailed(String t, int e) { }
            @Override public void onDiscoveryStarted(String t) { emit("log", "mDNS: procurando"); }
            @Override public void onDiscoveryStopped(String t) { }
            @Override public void onServiceLost(NsdServiceInfo i) { }
            @Override
            public void onServiceFound(final NsdServiceInfo found) {
                resolver.submit(new Runnable() {
                    @Override
                    public void run() {
                        final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
                        try {
                            nsd.resolveService(found, new NsdManager.ResolveListener() {
                                @Override public void onResolveFailed(NsdServiceInfo i, int e) { latch.countDown(); }
                                @Override
                                public void onServiceResolved(NsdServiceInfo i) {
                                    try {
                                        InetAddress h = i.getHost();
                                        if (h instanceof Inet4Address) {
                                            synchronized (out) { out.put(h.getHostAddress(), i.getServiceName()); }
                                            emit("log", "mDNS: " + i.getServiceName() + " " + h.getHostAddress());
                                        }
                                    } catch (Exception ignored) { }
                                    latch.countDown();
                                }
                            });
                            latch.await(3, TimeUnit.SECONDS);
                        } catch (Exception ignored) { }
                    }
                });
            }
        };
        try {
            nsd.discoverServices("_androidtvremote2._tcp", NsdManager.PROTOCOL_DNS_SD, listener);
            Thread.sleep(waitMs);
        } catch (Exception e) {
            emit("log", "mDNS erro: " + e.getMessage());
        } finally {
            try { nsd.stopServiceDiscovery(listener); } catch (Exception ignored) { }
            resolver.shutdown();
        }
    }

    /** Procura a TV por mDNS e também varrendo as portas 6467/6466 da sub-rede do Wi-Fi. */
    @PluginMethod
    public void scan(final PluginCall call) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                final java.util.Map<String, String> found = new java.util.LinkedHashMap<String, String>();
                Thread nsdThread = new Thread(new Runnable() {
                    @Override public void run() { nsdDiscover(found, 6000); }
                });
                nsdThread.start();

                List<String> hosts = candidateHosts();
                emit("log", "varrendo " + hosts.size() + " endereços da rede");
                ExecutorService pool = Executors.newFixedThreadPool(64);
                try {
                    List<Future<String>> futures = new ArrayList<Future<String>>();
                    for (final String host : hosts) {
                        futures.add(pool.submit(new Callable<String>() {
                            @Override
                            public String call() {
                                return (portOpen(host, AtvProtocol.PAIR_PORT) || portOpen(host, AtvProtocol.REMOTE_PORT)) ? host : null;
                            }
                        }));
                    }
                    for (Future<String> f : futures) {
                        try {
                            String h = f.get(25, TimeUnit.SECONDS);
                            if (h != null) synchronized (found) { if (!found.containsKey(h)) found.put(h, ""); }
                        } catch (Exception ignored) {
                        }
                    }
                } finally {
                    pool.shutdownNow();
                }
                try { nsdThread.join(8000); } catch (InterruptedException ignored) { }

                JSArray arr = new JSArray();
                JSObject names = new JSObject();
                synchronized (found) {
                    for (java.util.Map.Entry<String, String> e : found.entrySet()) {
                        arr.put(e.getKey());
                        names.put(e.getKey(), e.getValue());
                    }
                }
                JSObject result = new JSObject();
                result.put("hosts", arr);
                result.put("names", names);
                call.resolve(result);
            }
        }).start();
    }
}

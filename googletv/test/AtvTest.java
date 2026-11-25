package com.controletv.googletv;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** Teste no computador: uma "TV" falsa (servidor) segue o protocolo e o código do app fala com ela. */
public class AtvTest {
    static AtvProtocol.Identity tvId;
    static volatile String code;
    static final AtomicReference<String> gotKeys = new AtomicReference<String>("");
    static final CountDownLatch keysDone = new CountDownLatch(1);
    static volatile boolean pongOk = false;

    static SSLServerSocket server(int port) throws Exception {
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
        ks.load(null, null);
        char[] pw = "x".toCharArray();
        ks.setKeyEntry("tv", tvId.key, pw, new java.security.cert.Certificate[] {tvId.cert});
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, pw);
        TrustManager[] tm = {new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] c, String a) {}
            public void checkServerTrusted(X509Certificate[] c, String a) {}
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }};
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(kmf.getKeyManagers(), tm, null);
        SSLServerSocket s = (SSLServerSocket) ctx.getServerSocketFactory().createServerSocket(port);
        s.setNeedClientAuth(true);
        return s;
    }

    static void tvPairing(SSLServerSocket ss) throws Exception {
        SSLSocket c = (SSLSocket) ss.accept();
        c.startHandshake();
        X509Certificate clientCert = (X509Certificate) c.getSession().getPeerCertificates()[0];
        InputStream in = c.getInputStream();
        OutputStream out = c.getOutputStream();
        // pedido -> ack (11)
        List<AtvProtocol.Field> f = AtvProtocol.parse(AtvProtocol.readFrame(in));
        check(AtvProtocol.find(f, 10) != null, "pedido de pareamento");
        AtvProtocol.writeFrame(out, AtvProtocol.cat(AtvProtocol.fVarint(1, 2), AtvProtocol.fVarint(2, 200), AtvProtocol.fBytes(11, new byte[0])));
        f = AtvProtocol.parse(AtvProtocol.readFrame(in));
        check(AtvProtocol.find(f, 20) != null, "opções");
        AtvProtocol.writeFrame(out, AtvProtocol.cat(AtvProtocol.fVarint(1, 2), AtvProtocol.fVarint(2, 200), AtvProtocol.fBytes(20, AtvProtocol.fBytes(1, AtvProtocol.cat(AtvProtocol.fVarint(1, 3), AtvProtocol.fVarint(2, 6))))));
        f = AtvProtocol.parse(AtvProtocol.readFrame(in));
        check(AtvProtocol.find(f, 30) != null, "configuração");
        AtvProtocol.writeFrame(out, AtvProtocol.cat(AtvProtocol.fVarint(1, 2), AtvProtocol.fVarint(2, 200), AtvProtocol.fBytes(31, new byte[0])));
        // a TV escolhe o final do código e o 1º byte vem do hash
        byte[] h = AtvProtocol.secretHash(clientCert, tvId.cert, "00BEEF");
        code = String.format("%02X", h[0] & 0xFF) + "BEEF";
        f = AtvProtocol.parse(AtvProtocol.readFrame(in));
        AtvProtocol.Field sec = AtvProtocol.find(f, 40);
        check(sec != null, "secret");
        byte[] got = AtvProtocol.find(AtvProtocol.parse(sec.data), 1).data;
        check(java.util.Arrays.equals(got, AtvProtocol.secretHash(clientCert, tvId.cert, code)), "hash do código confere");
        AtvProtocol.writeFrame(out, AtvProtocol.cat(AtvProtocol.fVarint(1, 2), AtvProtocol.fVarint(2, 200), AtvProtocol.fBytes(41, new byte[0])));
        c.close();
    }

    static void tvRemote(SSLServerSocket ss) throws Exception {
        SSLSocket c = (SSLSocket) ss.accept();
        c.startHandshake();
        InputStream in = c.getInputStream();
        OutputStream out = c.getOutputStream();
        AtvProtocol.writeFrame(out, AtvProtocol.fBytes(1, AtvProtocol.fVarint(1, 639)));
        List<AtvProtocol.Field> f = AtvProtocol.parse(AtvProtocol.readFrame(in));
        AtvProtocol.Field cfg = AtvProtocol.find(f, 1);
        check(cfg != null && AtvProtocol.find(AtvProtocol.parse(cfg.data), 1).val == 622, "configure 622");
        AtvProtocol.writeFrame(out, AtvProtocol.fBytes(2, AtvProtocol.fVarint(1, 639)));
        f = AtvProtocol.parse(AtvProtocol.readFrame(in));
        check(AtvProtocol.find(f, 2) != null, "set_active");
        AtvProtocol.writeFrame(out, AtvProtocol.fBytes(8, AtvProtocol.fVarint(1, 25)));
        StringBuilder sb = new StringBuilder();
        // o app pode mandar a tecla antes de responder ao ping: aceita qualquer ordem
        int seen = 0;
        while (seen < 3) {
            f = AtvProtocol.parse(AtvProtocol.readFrame(in));
            AtvProtocol.Field pong = AtvProtocol.find(f, 9);
            if (pong != null) {
                pongOk = AtvProtocol.find(AtvProtocol.parse(pong.data), 1).val == 25;
                seen++;
            }
            AtvProtocol.Field k = AtvProtocol.find(f, 10);
            if (k != null) {
                List<AtvProtocol.Field> kk = AtvProtocol.parse(k.data);
                sb.append("key=").append(AtvProtocol.find(kk, 1).val).append("/dir=").append(AtvProtocol.find(kk, 2).val).append(" ");
                seen++;
            }
            AtvProtocol.Field l = AtvProtocol.find(f, 90);
            if (l != null) {
                sb.append("link=").append(new String(AtvProtocol.find(AtvProtocol.parse(l.data), 1).data, "UTF-8")).append(" ");
                seen++;
            }
        }
        gotKeys.set(sb.toString().trim());
        keysDone.countDown();
        Thread.sleep(300);
        c.close();
    }

    static void check(boolean ok, String what) {
        if (!ok) throw new RuntimeException("FALHOU: " + what);
        System.out.println("ok - " + what);
    }

    public static void main(String[] a) throws Exception {
        File dir = new File(System.getProperty("java.io.tmpdir"), "atvtest" + System.nanoTime());
        tvId = AtvProtocol.loadOrCreateIdentity(new File(dir, "tv"));
        AtvProtocol.Identity app = AtvProtocol.loadOrCreateIdentity(new File(dir, "app"));
        // o certificado montado à mão precisa ser válido e autoassinado
        app.cert.verify(app.cert.getPublicKey());
        check(app.cert.getSubjectX500Principal().getName().contains("atvremote"), "certificado autoassinado válido (CN=atvremote)");
        // recarregar do disco devolve o mesmo certificado
        AtvProtocol.Identity again = AtvProtocol.loadOrCreateIdentity(new File(dir, "app"));
        check(java.util.Arrays.equals(app.cert.getEncoded(), again.cert.getEncoded()), "identidade salva e recarregada");

        AtvProtocol.PAIR_PORT = 16467;
        AtvProtocol.REMOTE_PORT = 16466;
        final SSLServerSocket sp = server(16467);
        final SSLServerSocket sr = server(16466);
        final Exception[] err = new Exception[1];
        Thread t1 = new Thread(new Runnable() { public void run() { try { tvPairing(sp); } catch (Exception e) { err[0] = e; e.printStackTrace(); } } });
        Thread t2 = new Thread(new Runnable() { public void run() { try { tvRemote(sr); } catch (Exception e) { err[0] = e; e.printStackTrace(); } } });
        t1.start(); t2.start();

        AtvProtocol.Pairing p = new AtvProtocol.Pairing(app);
        p.start("127.0.0.1", "Teste");
        check(true, "pareamento iniciado (pedido, opções e configuração aceitos)");
        while (code == null) Thread.sleep(20);
        try {
            p.finish("FFFFFF");
            check(false, "código errado deveria falhar");
        } catch (IllegalArgumentException e) {
            check(true, "código errado é rejeitado localmente: " + e.getMessage());
        }
        p.finish(code.toLowerCase());
        check(true, "pareamento concluído com o código " + code);

        final CountDownLatch ready = new CountDownLatch(1);
        AtvProtocol.Remote r = new AtvProtocol.Remote(app, new AtvProtocol.Events() {
            public void onLog(String s) { System.out.println("  log: " + s); }
            public void onState(String s) { System.out.println("  estado: " + s); if (s.equals("ready")) ready.countDown(); }
        });
        r.connect("127.0.0.1");
        check(ready.await(5, TimeUnit.SECONDS), "controle chegou ao estado pronto");
        r.key(24, 3);
        r.launch("https://www.youtube.com");
        check(keysDone.await(5, TimeUnit.SECONDS), "TV recebeu as mensagens");
        System.out.println("TV recebeu: " + gotKeys.get());
        check(gotKeys.get().equals("key=24/dir=3 link=https://www.youtube.com"), "tecla de volume e link de app corretos");
        check(pongOk, "ping respondido com o mesmo valor");
        r.close();
        t1.join(2000); t2.join(2000);
        if (err[0] != null) throw err[0];
        System.out.println("TUDO OK");
        System.exit(0);
    }
}

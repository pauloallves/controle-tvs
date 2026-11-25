package com.controletv.googletv;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Protocolo "Android TV Remote v2" (Google TV / Android TV), sem dependências do Android
 * (para poder ser testado no computador).
 *
 *  - Pareamento: TLS na porta 6467, a TV mostra um código de 6 caracteres.
 *  - Controle:   TLS na porta 6466 com o mesmo certificado do app.
 *
 * Todas as mensagens são protobuf com prefixo de tamanho (varint), montadas à mão aqui.
 */
public final class AtvProtocol {

    private AtvProtocol() {}

    public static int PAIR_PORT = 6467;
    public static int REMOTE_PORT = 6466;

    public interface Events {
        void onLog(String line);

        void onState(String state);
    }

    // ------------------------------------------------------------------ protobuf mínimo

    static byte[] varint(long v) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        while ((v & ~0x7FL) != 0) {
            o.write((int) ((v & 0x7F) | 0x80));
            v >>>= 7;
        }
        o.write((int) v);
        return o.toByteArray();
    }

    static byte[] cat(byte[]... parts) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] p : parts) o.write(p, 0, p.length);
        return o.toByteArray();
    }

    static byte[] fVarint(int num, long v) {
        return cat(varint(((long) num << 3)), varint(v));
    }

    static byte[] fBytes(int num, byte[] b) {
        return cat(varint(((long) num << 3) | 2), varint(b.length), b);
    }

    static byte[] fString(int num, String s) {
        return fBytes(num, s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    static final class Field {
        int num;
        int wire;
        long val;
        byte[] data;
    }

    static List<Field> parse(byte[] b) {
        List<Field> out = new ArrayList<Field>();
        int[] pos = {0};
        while (pos[0] < b.length) {
            long tag = readVarint(b, pos);
            Field f = new Field();
            f.num = (int) (tag >>> 3);
            f.wire = (int) (tag & 7);
            if (f.wire == 0) {
                f.val = readVarint(b, pos);
            } else if (f.wire == 2) {
                int n = (int) readVarint(b, pos);
                if (n < 0 || pos[0] + n > b.length) throw new IllegalArgumentException("mensagem truncada");
                f.data = new byte[n];
                System.arraycopy(b, pos[0], f.data, 0, n);
                pos[0] += n;
            } else if (f.wire == 5) {
                pos[0] += 4;
            } else if (f.wire == 1) {
                pos[0] += 8;
            } else {
                throw new IllegalArgumentException("tipo de campo inesperado: " + f.wire);
            }
            out.add(f);
        }
        return out;
    }

    static long readVarint(byte[] b, int[] pos) {
        long r = 0;
        int shift = 0;
        while (true) {
            if (pos[0] >= b.length) throw new IllegalArgumentException("varint truncado");
            int x = b[pos[0]++] & 0xFF;
            r |= (long) (x & 0x7F) << shift;
            if ((x & 0x80) == 0) return r;
            shift += 7;
            if (shift > 63) throw new IllegalArgumentException("varint grande demais");
        }
    }

    static Field find(List<Field> fs, int num) {
        for (Field f : fs) if (f.num == num) return f;
        return null;
    }

    // ------------------------------------------------------------------ quadros (varint + payload)

    static void writeFrame(OutputStream o, byte[] payload) throws IOException {
        o.write(cat(varint(payload.length), payload));
        o.flush();
    }

    static byte[] readFrame(InputStream in) throws IOException {
        long len = 0;
        int shift = 0;
        while (true) {
            int x = in.read();
            if (x < 0) throw new IOException("conexão encerrada");
            len |= (long) (x & 0x7F) << shift;
            if ((x & 0x80) == 0) break;
            shift += 7;
            if (shift > 28) throw new IOException("tamanho inválido");
        }
        if (len < 0 || len > (1 << 20)) throw new IOException("mensagem grande demais");
        byte[] b = new byte[(int) len];
        new DataInputStream(in).readFully(b);
        return b;
    }

    // ------------------------------------------------------------------ identidade (certificado do app)

    public static final class Identity {
        public final PrivateKey key;
        public final X509Certificate cert;

        Identity(PrivateKey key, X509Certificate cert) {
            this.key = key;
            this.cert = cert;
        }
    }

    public static Identity loadOrCreateIdentity(File dir) throws Exception {
        File kf = new File(dir, "atv_key.pk8");
        File cf = new File(dir, "atv_cert.der");
        if (kf.exists() && cf.exists()) {
            try {
                PrivateKey k = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(readAll(kf)));
                X509Certificate c = (X509Certificate) CertificateFactory.getInstance("X.509")
                        .generateCertificate(new ByteArrayInputStream(readAll(cf)));
                return new Identity(k, c);
            } catch (Exception ignored) {
                // arquivos corrompidos: gera de novo (a TV precisará ser pareada outra vez)
            }
        }
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        KeyPair kp = g.generateKeyPair();
        byte[] der = buildSelfSignedCert(kp);
        X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(der));
        dir.mkdirs();
        writeAll(kf, kp.getPrivate().getEncoded());
        writeAll(cf, cert.getEncoded());
        return new Identity(kp.getPrivate(), cert);
    }

    public static void deleteIdentity(File dir) {
        new File(dir, "atv_key.pk8").delete();
        new File(dir, "atv_cert.der").delete();
    }

    private static byte[] readAll(File f) throws IOException {
        FileInputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
            return o.toByteArray();
        } finally {
            in.close();
        }
    }

    private static void writeAll(File f, byte[] b) throws IOException {
        FileOutputStream o = new FileOutputStream(f);
        try {
            o.write(b);
        } finally {
            o.close();
        }
    }

    // Certificado X.509 autoassinado, montado em DER à mão (evita depender do BouncyCastle).
    private static byte[] derLen(int n) {
        if (n < 128) return new byte[] {(byte) n};
        if (n < 256) return new byte[] {(byte) 0x81, (byte) n};
        return new byte[] {(byte) 0x82, (byte) (n >> 8), (byte) n};
    }

    private static byte[] tlv(int tag, byte[]... parts) {
        byte[] body = cat(parts);
        return cat(new byte[] {(byte) tag}, derLen(body.length), body);
    }

    private static byte[] utcTime(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyMMddHHmmss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return tlv(0x17, f.format(new Date(ms)).getBytes(java.nio.charset.StandardCharsets.US_ASCII));
    }

    static byte[] buildSelfSignedCert(KeyPair kp) throws Exception {
        byte[] sigAlg = tlv(0x30,
                tlv(0x06, new byte[] {0x2A, (byte) 0x86, 0x48, (byte) 0x86, (byte) 0xF7, 0x0D, 0x01, 0x01, 0x0B}),
                new byte[] {0x05, 0x00});
        byte[] name = tlv(0x30, tlv(0x31, tlv(0x30,
                tlv(0x06, new byte[] {0x55, 0x04, 0x03}),
                tlv(0x0C, "atvremote".getBytes(java.nio.charset.StandardCharsets.US_ASCII)))));
        long now = System.currentTimeMillis();
        byte[] validity = tlv(0x30, utcTime(now - 86400000L), utcTime(now + 3650L * 86400000L));
        byte[] serial = tlv(0x02, BigInteger.valueOf(now).toByteArray());
        byte[] tbs = tlv(0x30,
                tlv(0xA0, tlv(0x02, new byte[] {0x02})),
                serial, sigAlg, name, validity, name, kp.getPublic().getEncoded());
        Signature s = Signature.getInstance("SHA256withRSA");
        s.initSign(kp.getPrivate());
        s.update(tbs);
        byte[] sig = s.sign();
        return tlv(0x30, tbs, sigAlg, tlv(0x03, new byte[] {0x00}, sig));
    }

    // ------------------------------------------------------------------ TLS

    static SSLSocket connect(String ip, int port, Identity id, int timeoutMs) throws Exception {
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
        ks.load(null, null);
        char[] pw = "atv".toCharArray();
        ks.setKeyEntry("atv", id.key, pw, new java.security.cert.Certificate[] {id.cert});
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, pw);
        // A TV usa certificado autoassinado: aceitamos o dela (só vale para IP da rede local,
        // validado pelo plugin) e guardamos a chave pública para o cálculo do código.
        TrustManager[] tm = {new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] c, String a) {}

            public void checkServerTrusted(X509Certificate[] c, String a) {}

            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        }};
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(kmf.getKeyManagers(), tm, null);
        SSLSocket s = (SSLSocket) ctx.getSocketFactory().createSocket();
        try {
            s.connect(new InetSocketAddress(ip, port), timeoutMs);
            s.setSoTimeout(timeoutMs);
            s.startHandshake();
        } catch (Exception e) {
            try {
                s.close();
            } catch (Exception ignored) {
            }
            throw e;
        }
        return s;
    }

    // ------------------------------------------------------------------ pareamento

    private static byte[] pairingMsg(int field, byte[] inner) {
        return cat(fVarint(1, 2), fVarint(2, 200), fBytes(field, inner));
    }

    private static byte[] encoding() {
        return cat(fVarint(1, 3), fVarint(2, 6)); // hexadecimal, 6 símbolos
    }

    private static List<Field> expect(byte[] frame, int field, String what) {
        List<Field> fs = parse(frame);
        Field st = find(fs, 2);
        if (st != null && st.val != 200) {
            throw new IllegalStateException("A TV recusou (" + what + ", status " + st.val + ")");
        }
        if (find(fs, field) == null) {
            throw new IllegalStateException("Resposta inesperada da TV (" + what + ")");
        }
        return fs;
    }

    static byte[] unsignedBytes(BigInteger v) {
        byte[] b = v.toByteArray();
        int i = 0;
        while (i < b.length - 1 && b[i] == 0) i++;
        byte[] r = new byte[b.length - i];
        System.arraycopy(b, i, r, 0, r.length);
        return r;
    }

    static byte[] hexToBytes(String hex) {
        byte[] r = new byte[hex.length() / 2];
        for (int i = 0; i < r.length; i++) r[i] = (byte) Integer.parseInt(hex.substring(2 * i, 2 * i + 2), 16);
        return r;
    }

    /** SHA-256(modulo+expoente do app, modulo+expoente da TV, código sem o 1º byte). */
    static byte[] secretHash(X509Certificate client, X509Certificate server, String code) throws Exception {
        RSAPublicKey c = (RSAPublicKey) client.getPublicKey();
        RSAPublicKey s = (RSAPublicKey) server.getPublicKey();
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        md.update(unsignedBytes(c.getModulus()));
        md.update(unsignedBytes(c.getPublicExponent()));
        md.update(unsignedBytes(s.getModulus()));
        md.update(unsignedBytes(s.getPublicExponent()));
        md.update(hexToBytes(code.substring(2)));
        return md.digest();
    }

    public static final class Pairing {
        private final Identity id;
        private SSLSocket sock;
        private X509Certificate serverCert;

        public Pairing(Identity id) {
            this.id = id;
        }

        public void start(String ip, String clientName) throws Exception {
            close();
            sock = AtvProtocol.connect(ip, PAIR_PORT, id, 8000);
            serverCert = (X509Certificate) sock.getSession().getPeerCertificates()[0];
            InputStream in = sock.getInputStream();
            OutputStream out = sock.getOutputStream();

            writeFrame(out, pairingMsg(10, cat(fString(1, "atvremote"), fString(2, clientName))));
            expect(readFrame(in), 11, "pedido");
            writeFrame(out, pairingMsg(20, cat(fBytes(1, encoding()), fVarint(3, 1))));
            expect(readFrame(in), 20, "opções");
            writeFrame(out, pairingMsg(30, cat(fBytes(1, encoding()), fVarint(2, 1))));
            expect(readFrame(in), 31, "configuração");
            // agora a TV mostra o código na tela
        }

        public void finish(String codeIn) throws Exception {
            if (sock == null) throw new IllegalStateException("Inicie o pareamento primeiro");
            String code = codeIn == null ? "" : codeIn.trim().toUpperCase(Locale.US);
            if (!code.matches("[0-9A-F]{6}")) {
                throw new IllegalArgumentException("O código tem 6 caracteres (números e letras A-F)");
            }
            byte[] hash = secretHash(id.cert, serverCert, code);
            if ((hash[0] & 0xFF) != Integer.parseInt(code.substring(0, 2), 16)) {
                throw new IllegalArgumentException("Código incorreto: confira os 6 caracteres na TV");
            }
            writeFrame(sock.getOutputStream(), pairingMsg(40, fBytes(1, hash)));
            expect(readFrame(sock.getInputStream()), 41, "código");
            close();
        }

        public void close() {
            try {
                if (sock != null) sock.close();
            } catch (Exception ignored) {
            }
            sock = null;
        }
    }

    // ------------------------------------------------------------------ controle

    public static final class Remote {
        private final Identity id;
        private final Events ev;
        private SSLSocket sock;
        private OutputStream out;
        private volatile boolean ready;
        private volatile boolean closed;

        public Remote(Identity id, Events ev) {
            this.id = id;
            this.ev = ev;
        }

        public boolean isReady() {
            return ready && !closed;
        }

        public void connect(String ip) throws Exception {
            close();
            closed = false;
            ready = false;
            sock = AtvProtocol.connect(ip, REMOTE_PORT, id, 8000);
            sock.setSoTimeout(0);
            out = sock.getOutputStream();
            final InputStream in = sock.getInputStream();
            ev.onState("connected");
            final SSLSocket mine = sock;
            Thread t = new Thread(new Runnable() {
                public void run() {
                    try {
                        while (true) handle(readFrame(in));
                    } catch (Exception e) {
                        if (sock == mine && !closed) ev.onLog("conexão encerrada: " + e.getMessage());
                    } finally {
                        if (sock == mine) {
                            ready = false;
                            ev.onState("closed");
                        }
                    }
                }
            });
            t.setDaemon(true);
            t.start();
        }

        private void send(byte[] payload) throws IOException {
            synchronized (this) {
                if (out == null) throw new IOException("sem conexão");
                writeFrame(out, payload);
            }
        }

        private void handle(byte[] frame) throws IOException {
            List<Field> fs = parse(frame);
            for (Field f : fs) {
                if (f.num == 1) {
                    // informações da TV: responde com a configuração do app
                    byte[] dev = cat(fString(1, "Phone"), fString(2, "Controle TV"), fVarint(3, 1),
                            fString(4, "1"), fString(5, "controletv"), fString(6, "1.0.0"));
                    send(fBytes(1, cat(fVarint(1, 622), fBytes(2, dev))));
                    ev.onLog("TV conectada, enviando configuração");
                } else if (f.num == 2) {
                    send(fBytes(2, fVarint(1, 622)));
                    ready = true;
                    ev.onState("ready");
                    ev.onLog("pronto para enviar teclas");
                } else if (f.num == 8) {
                    long v = 0;
                    if (f.data != null) {
                        Field p = find(parse(f.data), 1);
                        if (p != null) v = p.val;
                    }
                    send(fBytes(9, fVarint(1, v)));
                } else if (f.num == 3) {
                    ev.onLog("erro da TV (mensagem 3)");
                } else {
                    ev.onLog("mensagem da TV: campo " + f.num);
                }
            }
        }

        /** direction: 1 = início do toque longo, 2 = fim, 3 = toque curto. */
        public void key(int code, int direction) throws IOException {
            if (!isReady()) throw new IOException("TV não está pronta");
            send(fBytes(10, cat(fVarint(1, code), fVarint(2, direction))));
        }

        public void launch(String url) throws IOException {
            if (!isReady()) throw new IOException("TV não está pronta");
            send(fBytes(90, fString(1, url)));
        }

        public void close() {
            closed = true;
            ready = false;
            try {
                if (sock != null) sock.close();
            } catch (Exception ignored) {
            }
            sock = null;
            out = null;
        }
    }
}

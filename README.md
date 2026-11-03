# Controle TV

Controle remoto em React para TVs. Hoje suporta **Samsung Tizen** (testado no perfil
da AU8000, 2021). Funciona de três jeitos com o mesmo código:

| Onde | Como | Observação |
|---|---|---|
| iPhone | PWA (Safari → Adicionar à Tela de Início) | precisa digitar o IP e aceitar o certificado da TV uma vez |
| Android (navegador) | PWA (Chrome → Instalar app) | idem; o Chrome mostra uma barra "não seguro" |
| **Android (app)** | **APK instalado direto** | **busca a TV sozinha, sem aviso de certificado** |

## 1) Site (GitHub Pages)

Workflow `.github/workflows/deploy.yml`. Em **Settings → Pages → Source** escolha
**GitHub Actions**. Endereço: `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

## 2) App Android (APK) gerado pelo GitHub

Workflow `.github/workflows/android.yml`: a cada push na `main` ele compila o app e
publica o arquivo **controle-tv.apk** em **Releases → "APK mais recente"**.

Como instalar: abra a página Releases do repositório no celular, baixe o
`controle-tv.apk`, abra o arquivo e permita "instalar apps desconhecidos" quando o
Android pedir. Para atualizar, baixe e instale o novo APK por cima.

O que acontece nos bastidores (`scripts/patch-android.mjs`):
- `npx cap add android` cria o projeto Android (Capacitor);
- o script copia o plugin nativo `native/TvSocketPlugin.java` (WebSocket que aceita
  o certificado da TV só para endereços de rede local + busca de TV na sub-rede),
  adiciona permissões, OkHttp e os ícones;
- o Gradle gera o APK de debug, assinado com `native/debug.keystore`.

> A chave `native/debug.keystore` é uma chave de **teste**, pública no repositório.
> Serve para uso pessoal (permite atualizar o app por cima). Para publicar na Play
> Store, crie uma chave própria e guarde-a como segredo.

## Rodar localmente

    npm install
    npm run dev      # teste no navegador
    npm run build    # gera dist/

## Se a conexão falhar (navegador)

A TV usa certificado autoassinado na porta 8002. Abra uma vez
`https://IP-DA-TV:8002` no navegador do celular, aceite o aviso e volte ao app.
No app Android isso não é necessário.

## Adicionar outra marca de TV

1. Crie `src/drivers/<marca>.js` com uma classe que siga o contrato descrito no
   topo de `src/drivers/samsung.js` (`connect`, `reconnect`, `disconnect`, `ready`,
   `key`, `launchApp`, `forgetPairing`). Os botões usam um vocabulário universal
   (`UP`, `OK`, `VOL_UP`, `5`...); o driver traduz para o protocolo da marca.
2. Registre em `src/drivers/index.js` (opcionalmente com uma função `discover` para
   a busca automática no app Android). O seletor de marca aparece sozinho.

Viabilidade: **LG webOS** (WebSocket, porta 3001) é parecida com a Samsung; **Roku**
usa HTTP simples (porta 8060); **Android TV/Google TV** exige certificado de cliente
e protocolo binário, e só é viável no app nativo.

## Limitações

- Com a TV totalmente desligada, o app não consegue ligá-la (precisa de Wake-on-LAN).
- Reserve o IP da TV no roteador para ele não mudar.
- A busca automática varre a sub-rede /24 do Wi-Fi do celular.

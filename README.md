# Plugin Antigravity (agy) para OpenCode

Use os modelos do **Antigravity CLI (`agy`)** (Gemini, Claude, GPT-OSS) direto no seletor de modelos do **OpenCode**, com o login que você já tem no `agy`. **Não precisa de chave de API.**

> Testado com **OpenCode 2.0.19** e **agy 1.2.13** no Windows 11.

## O que tem nesta pasta

| Arquivo | Para que serve |
|---|---|
| `agy/` | O plugin em si (5 arquivos). É esta pasta que vai para a configuração do OpenCode. |
| `install.ps1` | Instalador para **Windows** |
| `install.sh` | Instalador para **macOS / Linux** |
| `opencode.example.json` | Exemplo da configuração que o plugin usa |
| `README.md` | Este tutorial |

---

## 1. Pré-requisitos

1. **OpenCode 2.x** instalado. Confira no terminal:
   ```
   opencode --version
   ```
   Tem que aparecer `v2.algumacoisa`. Se aparecer `1.x`, atualize com `opencode upgrade`.

2. **Antigravity CLI (`agy`)** instalado **e logado**. Rode `agy` uma vez no terminal e faça o login que ele pedir. Depois confira:
   ```
   agy models
   ```
   Se aparecer uma lista de modelos (`gemini-3.1-pro-high`, `claude-sonnet-4-6`, etc.), está tudo certo.

## 2. Instalação

### Windows (automática, recomendado)

1. Extraia o zip em qualquer lugar.
2. Abra a pasta extraída, clique com o botão direito num espaço vazio e escolha **"Abrir no Terminal"**.
3. Cole e rode:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
4. **Feche e abra o OpenCode de novo.** Se você já tinha uma versão anterior deste plugin, rode também `opencode service restart` uma vez.

O instalador confere os pré-requisitos, copia o plugin e adiciona a configuração no seu `opencode.json`. Se o `opencode.json` já existia, ele faz backup antes (`opencode.json.bak-agy`).

### macOS / Linux

```
sh install.sh
```

Depois feche e abra o OpenCode.

### Manual (qualquer sistema)

1. Copie a pasta **`agy`** para dentro da pasta `plugins` da configuração do OpenCode:
   - Windows: `%USERPROFILE%\.config\opencode\plugins\`
   - macOS / Linux: `~/.config/opencode/plugins/`

   O resultado tem que ser `...\.config\opencode\plugins\agy\server.js` (e não `plugins\agy\agy\server.js`).
2. Na pasta `.config\opencode`, abra o `opencode.json` e adicione o bloco `"agy"` dentro de `"providers"`, igual ao `opencode.example.json`. Se o `opencode.json` não existir, copie o `opencode.example.json` para lá com o nome `opencode.json`.

> O OpenCode 2 carrega sozinho qualquer pasta que estiver em `plugins/`. Não precisa registrar o plugin em nenhum outro lugar.

## 3. Como usar

- **No OpenCode:** digite `/models`, procure o grupo **Antigravity (agy)** e escolha o modelo.
- **Pela linha de comando:**
  ```
  opencode run -m agy/gemini-3.1-pro-high "sua pergunta aqui"
  ```
- **Deixar como modelo padrão:** adicione esta linha no começo do `opencode.json`:
  ```json
  "model": "agy/gemini-3.1-pro-high",
  ```
- **Obsidian:** as extensões do Obsidian que usam o OpenCode funcionam igual. A pasta do vault é a pasta da sessão, então o agy consegue ler e editar as notas do vault.

A lista de modelos vem do próprio `agy` e é atualizada sozinha quando o OpenCode abre. Se o agy ganhar um modelo novo, ele aparece aqui.

> ⏱️ Cada resposta leva uns 5 a 10 segundos para começar, porque o `agy` é iniciado a cada mensagem. Os modelos Claude via agy podem levar uns 30 segundos.

## 4. Permissões (o que o agy pode fazer no seu PC)

O `agy` é um agente: ele usa as próprias ferramentas para ler arquivos, editar arquivos e rodar comandos. Dentro do OpenCode ele roda em segundo plano, então **não tem como te pedir autorização**. Tudo o que não estiver liberado é **negado automaticamente**, e o plugin mostra na resposta o que foi bloqueado e como liberar.

Quem controla isso é a opção `"permissions"` no `opencode.json`:

| `"permissions"` | Ler e escrever arquivos **na pasta aberta** | Outras pastas | Comandos de terminal |
|---|---|---|---|
| `"edit"` **(padrão)** | ✅ | ❌ (só as que estiverem em `addDirs`) | ❌ |
| `"read-only"` | só ler | ❌ | ❌ |
| `"skip"` | ✅ | ✅ | ✅ **tudo, sem perguntar** |

"Pasta aberta" é a pasta onde você abriu o OpenCode (ou o vault, no Obsidian). O agy só age quando você pede algo; a permissão só define até onde ele pode ir.

### Liberar outras pastas (duas formas, escolha uma)

**a) Pelo plugin**, no `opencode.json` (vale só dentro do OpenCode):

```json
"addDirs": ["C:/Users/SeuNome/Documents/Notas"]
```

**b) Pelo próprio agy**, no `settings.json` dele, seguindo a [documentação oficial de permissões](https://antigravity.google/docs/permissions). Vale no OpenCode e também quando você usa o `agy` no terminal. O arquivo fica em:

- Windows: `%USERPROFILE%\.gemini\antigravity-cli\settings.json`
- macOS / Linux: `~/.gemini/antigravity-cli/settings.json`

Exemplo completo e **válido** para Windows. Troque `SeuNome` pelo seu usuário e mantenha as outras chaves que já existirem no arquivo, como `"model"`:

```json
{
  "model": "Gemini 3.1 Pro (High)",
  "permissions": {
    "allow": [
      "write_file(C:/Users/SeuNome/Documents)",
      "write_file(C:/Users/SeuNome/OneDrive/Documents)",
      "command(git status)"
    ],
    "deny": [
      "command(rm -rf)"
    ],
    "ask": []
  }
}
```

Regras que funcionam:
- `write_file(pasta)` libera escrever **e** ler tudo dentro da pasta, inclusive subpastas.
- `read_file(pasta)` libera só a leitura.
- `command(início do comando)` libera comandos que começam assim (ex.: `command(git status)`).
- `mcp(servidor/ferramenta)` e `read_url(domínio)` também são aceitas.

No Windows, escreva o caminho com `/` (ex.: `C:/Users/...`). Esse formato foi testado. Nomes como `"ReadFile"` ou `"WriteToFile"` **não funcionam**.

> ⚠️ **O exemplo da página do Google é só ilustrativo.** Regras como `read_file(/var/log/app)`, `write_file(src/)` e `mcp(linter/*)` não têm a ver com os seus arquivos. Não cole o exemplo inteiro: escreva regras com as **suas** pastas.

> ⚠️ **Cuidado com o JSON.** Uma vírgula faltando ou sobrando (por exemplo `],` logo antes de um `}`) faz o agy **ignorar o arquivo inteiro sem avisar**, incluindo seu modelo padrão e todas as permissões. Depois de editar, confira num validador (ex.: jsonlint.com) ou procure a palavra `malformed` no arquivo `cli.log`, que fica na mesma pasta.

> ⚠️ **`"skip"`** deixa o agy rodar **qualquer** comando no seu PC sem perguntar, inclusive apagar arquivos. Use só se souber o que está fazendo.

## 5. Todas as opções

Tudo fica em `providers.agy.settings` no `opencode.json`. O OpenCode recarrega sozinho quando você salva o arquivo; se não recarregar, reinicie.

| Opção | Valores | O que faz |
|---|---|---|
| `permissions` | `"edit"` (padrão), `"read-only"`, `"skip"` | Veja a seção 4 |
| `addDirs` | lista de pastas | Pastas extras onde o agy pode ler e escrever |
| `effort` | `"low"`, `"medium"`, `"high"`, `"max"` | Quanto o modelo "pensa" (quando o modelo suporta) |
| `mode` | `"plan"` | Usa o modo de planejamento do agy no lugar do modo de edição |
| `agyPath` | caminho do executável | Use se o `agy` não for encontrado automaticamente |
| `printTimeout` | ex.: `"15m"` | Tempo máximo por resposta |
| `toolActivity` | `"reasoning"` (padrão), `"off"` | Mostra (ou esconde) as ferramentas que o agy usou, como "Thinking" |
| `system` | `"wrap"` (padrão), `"omit"` | Envia (ou não) as instruções do OpenCode e do seu AGENTS.md para o agy |
| `resume` | `true` (padrão), `false` | Continua a conversa do agy entre mensagens em vez de reenviar o histórico todo |
| `titles` | `"agy"` | Gera o título das sessões com o agy (por padrão o título é feito localmente, sem gastar cota) |
| `debug` | `true` | Registra os prompts completos no log |

Também dá para ajustar um modelo específico, por exemplo o tamanho de contexto:

```json
"providers": {
  "agy": {
    "settings": { "permissions": "edit" },
    "models": {
      "gemini-3.1-pro-high": { "limit": { "context": 500000 } }
    }
  }
}
```

## 6. Conferindo se funcionou

```
opencode plugin list
```
Deve mostrar uma linha `agy   local   ...\plugins\agy\server.js`.

```
opencode models
```
Deve listar `agy/gemini-...`, `agy/claude-...` etc.

```
opencode run -m agy/gemini-3.8-flash-low "Responda só: ok"
```
Deve responder `ok`.

## 7. Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| Os modelos `agy/...` não aparecem | Confira se `opencode --version` é 2.x, se o arquivo ficou em `.config\opencode\plugins\agy\server.js` e se `agy models` funciona no terminal. Depois reinicie o OpenCode. |
| "agy is not signed in" | Rode `agy` no terminal e faça login de novo. |
| "Could not start agy" | O agy não está no PATH. Coloque `"agyPath": "C:/caminho/para/agy.exe"` nas settings. No Windows ele costuma ficar em `%LOCALAPPDATA%\agy\bin\agy.exe`. |
| "…not allowed to use: WriteToFile" | O agy tentou escrever fora da pasta aberta, ou está em `read-only`. Abra o OpenCode na pasta certa, libere a pasta (seção 4) ou mude para `"edit"`. |
| Continua negando mesmo depois de instalar ou atualizar o plugin | O serviço do OpenCode ainda está com uma versão antiga carregada. Rode `opencode service restart` uma vez. Fechar o app não basta, porque o serviço continua rodando em segundo plano. |
| Numa conversa antiga, o agy nem tenta escrever | Ele "lembra" que foi negado antes. Peça de novo ("tente de novo agora") ou abra uma sessão nova. |
| "…not allowed to use: RunCommand" | Comandos são bloqueados por padrão. Veja a seção 4. |
| O agy ignora as configurações dele | O `settings.json` do agy tem erro de sintaxe. Procure `malformed` em `%USERPROFILE%\.gemini\antigravity-cli\cli.log` e corrija o JSON (quase sempre é vírgula). |
| "agy does not offer this model any more" | O modelo saiu do agy. Reinicie o OpenCode para atualizar a lista. |
| Erro de quota ou rate limit | É o limite da sua conta Antigravity. Espere um pouco ou troque de modelo. |
| Resposta lenta | É normal: o agy é iniciado a cada mensagem e manda cerca de 12 mil tokens de instruções próprias. Os modelos Flash são os mais rápidos. |

**Log do plugin** (cada mensagem e cada erro):
- Windows: `%USERPROFILE%\.local\share\opencode\log\agy-provider.log`
- macOS / Linux: `~/.local/share/opencode/log/agy-provider.log`

Com `"debug": true`, o log também guarda os prompts completos.

## 8. Como funciona (para os curiosos)

1. **`server.js`** é o plugin do OpenCode. Ele roda `agy models`, registra cada modelo como `agy/<id>` e avisa em qual pasta está cada sessão.
2. **`provider.js`** é o ponto de entrada que o OpenCode carrega para o provedor. Ele é mínimo e recarrega o `model.js` e o `agy.js` sempre que esses arquivos mudam, então atualizações do plugin valem na próxima mensagem, sem reiniciar.
3. **`model.js`** é o "modelo" em si. A cada mensagem, ele inicia o `agy` na pasta da sessão, envia o prompt pela entrada padrão e transmite a resposta de volta em tempo real.
4. **`agy.js`** cuida do processo `agy`: encontra o executável, aplica as permissões, lê a saída, traduz erros para mensagens claras e grava o log.

A autenticação é sempre a do seu `agy`: o plugin nunca lê nem guarda chaves ou senhas.

## 9. Limitações

- As ferramentas do próprio OpenCode não são usadas: o agy usa as dele, que aparecem como "Thinking" na resposta.
- Imagens e anexos não são enviados ao agy, só texto.
- Cada mensagem inclui cerca de 12 mil tokens de instruções do próprio agy, que contam na sua cota.

## 10. Desinstalar

1. Apague a pasta `.config\opencode\plugins\agy`.
2. Tire o bloco `"agy"` de `"providers"` no `opencode.json`.
3. (Opcional) Apague `agy-models.json` e `agy-conversations.json` em `%USERPROFILE%\.cache\opencode\` (no macOS/Linux, `~/.cache/opencode/`).
